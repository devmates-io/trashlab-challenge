// §6.10.3 — duplicate-bill detection.
//
// Definition of a duplicate (deliberately narrow):
//   • same vendor_id
//   • same invoice_number (case-insensitive — finance teams enter
//     "INV-001" and "inv-001" interchangeably and we don't want to miss
//     either direction)
//   • status != "rejected" — a rejected duplicate is fine to recreate;
//     that's literally the cloning flow
//   • created within the last 365 days — older invoices with reused
//     numbers (multi-year vendor cycles) are rare but legit
//
// We do NOT use amount as part of the match. A vendor billing twice for
// the same invoice number with a different amount is a stronger duplicate
// signal, not weaker, so amount-mismatch should still warn. The dialog
// shows the existing amount alongside the candidate so the user can make
// the call.
//
// We cap matches at 5; the pre-flight + 409 dialog only surface a small
// list, and we don't want to load arbitrarily many rows.

import { prisma } from "../db.js";
import type { PossibleDuplicateMatch } from "@bill-pay/shared";

const DUPLICATE_WINDOW_MS = 365 * 24 * 60 * 60 * 1000;
const MAX_MATCHES = 5;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function findDuplicates(
  vendorId: string,
  invoiceNumber: string,
  excludeBillId?: string,
): Promise<PossibleDuplicateMatch[]> {
  const since = new Date(Date.now() - DUPLICATE_WINDOW_MS);

  const matches = await prisma.bill.findMany({
    where: {
      vendorId,
      invoiceNumber: { equals: invoiceNumber, mode: "insensitive" },
      status: { not: "rejected" },
      createdAt: { gte: since },
      ...(excludeBillId ? { id: { not: excludeBillId } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: MAX_MATCHES,
    include: { vendor: { select: { id: true, name: true } } },
  });

  return matches.map((m) => ({
    id: m.id,
    invoice_number: m.invoiceNumber,
    amount_cents: m.amountCents,
    status: m.status,
    issue_date: isoDate(m.issueDate),
    due_date: isoDate(m.dueDate),
    vendor_id: m.vendor.id,
    vendor_name: m.vendor.name,
    created_at: m.createdAt.toISOString(),
  }));
}
