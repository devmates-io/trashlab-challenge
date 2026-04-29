import { Router } from "express";
import {
  billCreateRequestSchema,
  billListQuerySchema,
  billPatchRequestSchema,
} from "@bill-pay/shared";
import { prisma } from "../db.js";
import { HttpProblem } from "../lib/problem.js";
import { validate } from "../middleware/validate.js";
import {
  billDetailInclude,
  billDetailToDto,
  billSummaryToDtoWithPendingApprovers,
} from "../lib/dto.js";
import {
  approveBillT5T6,
  cloneBill,
  createBill,
  deleteBill,
  editBill,
  payBill,
  recallBill,
  submitBill,
} from "../services/bill-state.js";

export const billsRouter = Router();

// GET /bills — list, sorted by due_date asc, optional ?status= filter.
// Includes `pending_approver_names` per §6.6.4 (union of names across pending
// BillApproval rows' `eligibleApproverUserIds`, deduplicated).
billsRouter.get(
  "/bills",
  validate(billListQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const { status } = req.query as unknown as { status?: string };
      const [rows, users] = await Promise.all([
        prisma.bill.findMany({
          where: status ? { status: status as never } : undefined,
          orderBy: { dueDate: "asc" },
          include: {
            vendor: { select: { name: true } },
            creator: { select: { name: true } },
            approvals: {
              select: { status: true, eligibleApproverUserIds: true },
            },
            attachment: { select: { id: true } },
          },
        }),
        prisma.user.findMany({ select: { id: true, name: true } }),
      ]);
      const userNameById = new Map(users.map((u) => [u.id, u.name] as const));
      res.json(
        rows.map((r) => billSummaryToDtoWithPendingApprovers(r, userNameById)),
      );
    } catch (err) {
      next(err);
    }
  },
);

// POST /bills — T1 create draft.
billsRouter.post(
  "/bills",
  validate(billCreateRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as typeof billCreateRequestSchema._output;
      const bill = await createBill(
        req.user!,
        {
          vendor_id: body.vendor_id,
          invoice_number: body.invoice_number,
          amount_cents: body.amount_cents,
          issue_date: body.issue_date,
          due_date: body.due_date,
          line_items: body.line_items,
          attachment_id: body.attachment_id ?? null,
        },
        req.realUser!,
      );
      res.status(201).json(billDetailToDto(bill));
    } catch (err) {
      next(err);
    }
  },
);

// GET /bills/:id — full BillDetailDTO.
billsRouter.get("/bills/:id", async (req, res, next) => {
  try {
    const bill = await prisma.bill.findUnique({
      where: { id: req.params.id },
      include: billDetailInclude,
    });
    if (!bill) {
      throw new HttpProblem({
        status: 404,
        code: "NOT_FOUND",
        title: "Bill not found",
        detail: "No bill with that id.",
      });
    }
    res.json(billDetailToDto(bill));
  } catch (err) {
    next(err);
  }
});

// PATCH /bills/:id — T2 edit draft.
billsRouter.patch(
  "/bills/:id",
  validate(billPatchRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as typeof billPatchRequestSchema._output;
      const bill = await editBill(
        req.user!,
        req.params.id,
        {
          vendor_id: body.vendor_id,
          invoice_number: body.invoice_number,
          amount_cents: body.amount_cents,
          issue_date: body.issue_date,
          due_date: body.due_date,
          line_items: body.line_items,
          attachment_id: body.attachment_id,
        },
        req.realUser!,
      );
      res.json(billDetailToDto(bill));
    } catch (err) {
      next(err);
    }
  },
);

// DELETE /bills/:id — T3 delete draft.
billsRouter.delete("/bills/:id", async (req, res, next) => {
  try {
    await deleteBill(req.user!, req.params.id);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});

// POST /bills/:id/submit — T4.
billsRouter.post("/bills/:id/submit", async (req, res, next) => {
  try {
    const bill = await submitBill(req.user!, req.params.id, req.realUser!);
    res.json(billDetailToDto(bill));
  } catch (err) {
    next(err);
  }
});

// POST /bills/:id/approve — T5/T6 (one-click decides all eligible slots).
billsRouter.post("/bills/:id/approve", async (req, res, next) => {
  try {
    const bill = await approveBillT5T6(
      req.user!,
      req.params.id,
      req.realUser!,
    );
    res.json(billDetailToDto(bill));
  } catch (err) {
    next(err);
  }
});

// POST /bills/:id/recall — T8.
billsRouter.post("/bills/:id/recall", async (req, res, next) => {
  try {
    const bill = await recallBill(req.user!, req.params.id, req.realUser!);
    res.json(billDetailToDto(bill));
  } catch (err) {
    next(err);
  }
});

// POST /bills/:id/pay — T9. Idempotency-Key header makes repeat calls return
// the same Payment (§6.5.4).
billsRouter.post("/bills/:id/pay", async (req, res, next) => {
  try {
    const rawKey = req.header("Idempotency-Key");
    const idemKey =
      typeof rawKey === "string" && rawKey.trim() !== "" ? rawKey.trim() : null;
    const bill = await payBill(
      req.user!,
      req.params.id,
      idemKey,
      req.realUser!,
    );
    res.json(billDetailToDto(bill));
  } catch (err) {
    next(err);
  }
});

// POST /bills/:id/clone — T10 (only rejected bills are cloneable).
billsRouter.post("/bills/:id/clone", async (req, res, next) => {
  try {
    const bill = await cloneBill(req.user!, req.params.id, req.realUser!);
    res.status(201).json(billDetailToDto(bill));
  } catch (err) {
    next(err);
  }
});
