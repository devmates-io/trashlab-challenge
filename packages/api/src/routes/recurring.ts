import { Router } from "express";
import {
  recurringTemplateCreateRequestSchema,
  recurringTemplateUpdateRequestSchema,
  type BillLineItemCreate,
} from "@bill-pay/shared";
import { prisma } from "../db.js";
import { HttpProblem } from "../lib/problem.js";
import { validate } from "../middleware/validate.js";
import { fromDateString } from "../lib/dto.js";
import {
  recurringTemplateInclude,
  runDueTemplates,
  templateRowToDto,
} from "../services/recurring.js";

// §6.10.5 — recurring bill template endpoints.
//
// Authorization model:
//   • Anyone authenticated can list / create / read / update / delete
//     templates they OWN (createdByUserId = req.user.id).
//   • Admins additionally can manage anyone's templates.
//   • The materializer (POST /run-due) runs only the caller's templates
//     for non-admins; admins materialize everyone's. Mirrors the same
//     "admin sees everything" pattern used elsewhere in the codebase.
//
// Validation invariants that mirror the bill model:
//   • amount_cents == sum(line_items.amount_cents)
//   • line_items length >= 1
//   • next_run_at is required at creation; advances automatically thereafter
//
// We don't snapshot vendor payment details on the template (the way Payment
// snapshots them) because the materialised draft is not yet a payment —
// when it's eventually paid via the normal bill flow, that step does the
// snapshot at decision time.

export const recurringRouter = Router();

function notFound(): HttpProblem {
  return new HttpProblem({
    status: 404,
    code: "NOT_FOUND",
    title: "Template not found",
    detail: "No recurring template with that id.",
  });
}

function forbidden(): HttpProblem {
  return new HttpProblem({
    status: 403,
    code: "FORBIDDEN",
    title: "Forbidden",
    detail: "You may only manage templates you created, unless you are an admin.",
  });
}

function assertLineItemSum(
  amountCents: number,
  lineItems: BillLineItemCreate[],
) {
  const sum = lineItems.reduce((acc, li) => acc + li.amount_cents, 0);
  if (sum !== amountCents) {
    throw new HttpProblem({
      status: 400,
      code: "VALIDATION_ERROR",
      title: "Invalid request body",
      detail: "amount_cents must equal the sum of line item amounts.",
      fieldIssues: [
        {
          path: "amount_cents",
          message: `Expected ${sum} (sum of line items), got ${amountCents}`,
        },
      ],
    });
  }
}

async function assertVendorActive(vendorId: string) {
  const v = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { id: true, isActive: true },
  });
  if (!v) {
    throw new HttpProblem({
      status: 404,
      code: "VENDOR_NOT_FOUND",
      title: "Vendor not found",
      detail: "No vendor with that id.",
    });
  }
  if (!v.isActive) {
    throw new HttpProblem({
      status: 409,
      code: "VENDOR_INACTIVE",
      title: "Vendor inactive",
      detail: "Cannot create a recurring template for an inactive vendor.",
    });
  }
}

// GET /recurring-templates — list. Non-admin sees only their own;
// admin sees everyone's.
recurringRouter.get("/recurring-templates", async (req, res, next) => {
  try {
    const isAdmin = req.user!.role === "admin";
    const rows = await prisma.recurringBillTemplate.findMany({
      where: isAdmin ? {} : { createdByUserId: req.user!.id },
      orderBy: { nextRunAt: "asc" },
      include: recurringTemplateInclude,
    });
    res.json(rows.map(templateRowToDto));
  } catch (err) {
    next(err);
  }
});

// POST /recurring-templates — create. The owner is always the acting
// user; admins creating templates on behalf of someone else would need
// a separate "owner_id" field, which the demo doesn't justify.
recurringRouter.post(
  "/recurring-templates",
  validate(recurringTemplateCreateRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as typeof recurringTemplateCreateRequestSchema._output;
      assertLineItemSum(body.amount_cents, body.line_items);
      await assertVendorActive(body.vendor_id);

      const row = await prisma.recurringBillTemplate.create({
        data: {
          name: body.name,
          vendorId: body.vendor_id,
          amountCents: body.amount_cents,
          cadence: body.cadence,
          nextRunAt: fromDateString(body.next_run_at),
          lineItems: body.line_items as unknown as object,
          createdByUserId: req.user!.id,
        },
        include: recurringTemplateInclude,
      });
      res.status(201).json(templateRowToDto(row));
    } catch (err) {
      next(err);
    }
  },
);

// GET /recurring-templates/:id — fetch one.
recurringRouter.get("/recurring-templates/:id", async (req, res, next) => {
  try {
    const row = await prisma.recurringBillTemplate.findUnique({
      where: { id: req.params.id },
      include: recurringTemplateInclude,
    });
    if (!row) throw notFound();
    if (row.createdByUserId !== req.user!.id && req.user!.role !== "admin") {
      throw forbidden();
    }
    res.json(templateRowToDto(row));
  } catch (err) {
    next(err);
  }
});

// PATCH /recurring-templates/:id — partial update. Cadence change applies
// from the next materialization onward (we don't recompute nextRunAt
// retroactively). If line_items is sent, amount_cents must accompany it
// (or be unchanged) and the sum invariant is re-checked.
recurringRouter.patch(
  "/recurring-templates/:id",
  validate(recurringTemplateUpdateRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as typeof recurringTemplateUpdateRequestSchema._output;
      const existing = await prisma.recurringBillTemplate.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) throw notFound();
      if (
        existing.createdByUserId !== req.user!.id &&
        req.user!.role !== "admin"
      ) {
        throw forbidden();
      }

      const nextLineItems =
        body.line_items ??
        (existing.lineItems as unknown as BillLineItemCreate[]);
      const nextAmount = body.amount_cents ?? existing.amountCents;
      if (body.line_items !== undefined || body.amount_cents !== undefined) {
        assertLineItemSum(nextAmount, nextLineItems);
      }
      if (body.vendor_id !== undefined && body.vendor_id !== existing.vendorId) {
        await assertVendorActive(body.vendor_id);
      }

      const row = await prisma.recurringBillTemplate.update({
        where: { id: existing.id },
        data: {
          name: body.name,
          vendorId: body.vendor_id,
          amountCents: body.amount_cents,
          cadence: body.cadence,
          nextRunAt: body.next_run_at
            ? fromDateString(body.next_run_at)
            : undefined,
          lineItems:
            body.line_items !== undefined
              ? (body.line_items as unknown as object)
              : undefined,
        },
        include: recurringTemplateInclude,
      });
      res.json(templateRowToDto(row));
    } catch (err) {
      next(err);
    }
  },
);

// POST /recurring-templates/:id/pause — flip pausedAt on. Idempotent.
recurringRouter.post(
  "/recurring-templates/:id/pause",
  async (req, res, next) => {
    try {
      const existing = await prisma.recurringBillTemplate.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) throw notFound();
      if (
        existing.createdByUserId !== req.user!.id &&
        req.user!.role !== "admin"
      ) {
        throw forbidden();
      }
      const row = await prisma.recurringBillTemplate.update({
        where: { id: existing.id },
        data: { pausedAt: existing.pausedAt ?? new Date() },
        include: recurringTemplateInclude,
      });
      res.json(templateRowToDto(row));
    } catch (err) {
      next(err);
    }
  },
);

// POST /recurring-templates/:id/resume — flip pausedAt off.
recurringRouter.post(
  "/recurring-templates/:id/resume",
  async (req, res, next) => {
    try {
      const existing = await prisma.recurringBillTemplate.findUnique({
        where: { id: req.params.id },
      });
      if (!existing) throw notFound();
      if (
        existing.createdByUserId !== req.user!.id &&
        req.user!.role !== "admin"
      ) {
        throw forbidden();
      }
      const row = await prisma.recurringBillTemplate.update({
        where: { id: existing.id },
        data: { pausedAt: null },
        include: recurringTemplateInclude,
      });
      res.json(templateRowToDto(row));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /recurring-templates/:id — hard delete. The template has no
// references from other entities (materialised bills carry a payload
// reference but no FK), so a hard delete is safe and matches "delete
// the blueprint" UX expectations.
recurringRouter.delete("/recurring-templates/:id", async (req, res, next) => {
  try {
    const existing = await prisma.recurringBillTemplate.findUnique({
      where: { id: req.params.id },
    });
    if (!existing) throw notFound();
    if (
      existing.createdByUserId !== req.user!.id &&
      req.user!.role !== "admin"
    ) {
      throw forbidden();
    }
    await prisma.recurringBillTemplate.delete({ where: { id: existing.id } });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /recurring-templates/run-due — materialize every due template the
// caller is allowed to run. Admin runs everyone's; non-admin runs only
// their own. Returns the list of created bills.
recurringRouter.post(
  "/recurring-templates/run-due",
  async (req, res, next) => {
    try {
      const isAdmin = req.user!.role === "admin";
      const ran = await runDueTemplates(isAdmin ? undefined : req.user!.id);
      res.json({ ran });
    } catch (err) {
      next(err);
    }
  },
);
