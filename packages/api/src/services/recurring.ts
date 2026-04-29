// §6.10.5 — recurring bill template materializer.
//
// A template is a blueprint that produces a draft Bill on a fixed cadence.
// The materializer is invoked manually via POST /recurring-templates/run-due
// — there is no cron, no queue, no background job, mirroring the spec's
// §4.6 boundary ("no jobs"). The reviewer clicks "Run due now" and sees
// the drafts appear.
//
// Cadence math is intentionally simple: monthly = same day next month,
// quarterly = +3 months, yearly = +1 year, with month-end clamping so
// "Jan 31 + monthly" lands on the last day of February rather than
// silently producing March 3.

import type { Prisma, RecurringBillTemplate, RecurringCadence } from "@prisma/client";
import { fromDateString, billDetailInclude } from "../lib/dto.js";
import { prisma } from "../db.js";
import type { BillLineItemCreate } from "@bill-pay/shared";

// Add months with clamping. JS Date naively rolls over: +1 month from
// Jan 31 produces Mar 3 because Feb doesn't have 31. We want to land on
// Feb 28/29 instead so monthly billing stays anchored to "month-end".
export function addMonthsClamped(date: Date, months: number): Date {
  const target = new Date(date.getTime());
  const year = target.getUTCFullYear();
  const month = target.getUTCMonth() + months;
  const day = target.getUTCDate();
  // Set to first of target month, then ask for the actual day. If it
  // overflows (e.g. day=31 in a 30-day month), fall back to the last day
  // of the target month.
  const candidate = new Date(Date.UTC(year, month, 1));
  const lastOfTarget = new Date(
    Date.UTC(candidate.getUTCFullYear(), candidate.getUTCMonth() + 1, 0),
  ).getUTCDate();
  candidate.setUTCDate(Math.min(day, lastOfTarget));
  // Preserve the original time component (templates use UTC midnight; this
  // is defence in depth in case future inputs carry a non-zero time).
  candidate.setUTCHours(
    target.getUTCHours(),
    target.getUTCMinutes(),
    target.getUTCSeconds(),
    target.getUTCMilliseconds(),
  );
  return candidate;
}

export function advanceForCadence(
  current: Date,
  cadence: RecurringCadence,
): Date {
  switch (cadence) {
    case "monthly":
      return addMonthsClamped(current, 1);
    case "quarterly":
      return addMonthsClamped(current, 3);
    case "yearly":
      return addMonthsClamped(current, 12);
  }
}

// ISO date helper (YYYY-MM-DD, UTC) — keeps the template's stored DateTime
// addressable as a date string in the wire and on the form.
export function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Compute the due date for a materialized bill. We use the template's
// nextRunAt as the issue date and add 30 days as a default payment
// terms window. A future enhancement could store `terms_days` on the
// template; for now 30 days is the SMB default.
const DEFAULT_TERMS_DAYS = 30;

interface MaterializedBill {
  templateId: string;
  templateName: string;
  billId: string;
  nextRunAt: string;
}

// Runs a single template: creates a draft Bill from its blueprint and
// advances `nextRunAt` by the cadence. Inside a single transaction so a
// failure rolls back both the bill creation AND the cursor advance.
async function runTemplate(
  tx: Prisma.TransactionClient,
  template: RecurringBillTemplate,
  uploadDir: string | undefined,
): Promise<MaterializedBill> {
  void uploadDir; // placeholder — attachments not yet supported on templates
  const lineItems = template.lineItems as unknown as BillLineItemCreate[];
  const now = new Date();
  const issueDate = template.nextRunAt;
  const dueDate = new Date(issueDate.getTime() + DEFAULT_TERMS_DAYS * 24 * 60 * 60 * 1000);

  // The invoice number is auto-generated from the template name + the
  // run date. AP teams who care will edit it on the draft before submit;
  // we just need a unique-looking string that doesn't collide and that
  // identifies the source.
  const slug = template.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 12) || "recurring";
  const invoiceNumber = `RC-${slug}-${toIsoDate(issueDate).replace(/-/g, "")}`;

  const bill = await tx.bill.create({
    data: {
      vendorId: template.vendorId,
      invoiceNumber,
      amountCents: template.amountCents,
      issueDate: fromDateString(toIsoDate(issueDate)),
      dueDate: fromDateString(toIsoDate(dueDate)),
      status: "draft",
      createdByUserId: template.createdByUserId,
      lineItems: {
        create: lineItems.map((li) => ({
          description: li.description,
          amountCents: li.amount_cents,
        })),
      },
    },
  });

  await tx.billEvent.create({
    data: {
      billId: bill.id,
      eventType: "created",
      actorUserId: template.createdByUserId,
      occurredAt: now,
      payload: {
        amount_cents: bill.amountCents,
        vendor_id: bill.vendorId,
        from_recurring_template_id: template.id,
      },
    },
  });

  const nextRunAt = advanceForCadence(template.nextRunAt, template.cadence);
  await tx.recurringBillTemplate.update({
    where: { id: template.id },
    data: {
      lastRunAt: now,
      nextRunAt,
    },
  });

  return {
    templateId: template.id,
    templateName: template.name,
    billId: bill.id,
    nextRunAt: toIsoDate(nextRunAt),
  };
}

// Materialise every active, non-paused template whose nextRunAt is in
// the past. Each template runs in its own transaction so a failure on
// template N doesn't roll back templates 1..N-1 — the cursor on each
// successful template advances independently.
export async function runDueTemplates(
  scopedToUserId?: string,
): Promise<MaterializedBill[]> {
  const now = new Date();
  const where: Prisma.RecurringBillTemplateWhereInput = {
    isActive: true,
    pausedAt: null,
    nextRunAt: { lte: now },
    ...(scopedToUserId ? { createdByUserId: scopedToUserId } : {}),
  };
  const due = await prisma.recurringBillTemplate.findMany({
    where,
    orderBy: { nextRunAt: "asc" },
  });

  const results: MaterializedBill[] = [];
  for (const tpl of due) {
    const result = await prisma.$transaction((tx) =>
      runTemplate(tx, tpl, process.env.UPLOAD_DIR),
    );
    results.push(result);
  }
  return results;
}

// Used by GET /recurring-templates/:id — full row with the bill we'd
// produce on its next run. Re-exported here so the route can compose it
// with the dto helpers below.
export const recurringTemplateInclude = {
  vendor: { select: { name: true } },
} as const;

export type RecurringTemplateRow = Prisma.RecurringBillTemplateGetPayload<{
  include: typeof recurringTemplateInclude;
}>;

export function templateRowToDto(row: RecurringTemplateRow) {
  return {
    id: row.id,
    name: row.name,
    vendor_id: row.vendorId,
    vendor_name: row.vendor.name,
    amount_cents: row.amountCents,
    cadence: row.cadence,
    next_run_at: toIsoDate(row.nextRunAt),
    last_run_at: row.lastRunAt ? toIsoDate(row.lastRunAt) : null,
    line_items: row.lineItems as unknown as BillLineItemCreate[],
    paused_at: row.pausedAt ? row.pausedAt.toISOString() : null,
    is_active: row.isActive,
    created_by_user_id: row.createdByUserId,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

// Re-export for the route — helps the route file stay focused on HTTP
// concerns and dispatch.
export { billDetailInclude };
