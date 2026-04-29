import { Router } from "express";
import {
  billCreateRequestSchema,
  billExtractRequestSchema,
  billListQuerySchema,
  billPatchRequestSchema,
  bulkBillsRequestSchema,
  checkDuplicateQuerySchema,
  type BulkBillResult,
  type BulkBillsResponse,
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
import { extractFromAttachment } from "../services/ocr.js";
import { findDuplicates } from "../services/duplicates.js";

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
//
// §6.10.3 — runs a duplicate check before creating. The check matches on
// (vendor_id, invoice_number) within the last 365 days, ignoring rejected
// bills. When matches exist and `?force=true` is NOT set, the response is
// 409 POSSIBLE_DUPLICATE with the matches embedded in the problem document
// — the client renders a confirmation dialog and retries with `?force=true`.
//
// We choose 409 (not 400) because the request itself is well-formed — it's
// just in conflict with existing state. Force-bypassing is a deliberate UI
// gesture, not a validation suppression, so a separate query param keeps
// the semantics clean (no "force" body field bleeding into normal callers).
billsRouter.post(
  "/bills",
  validate(billCreateRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as typeof billCreateRequestSchema._output;
      const force = String(req.query.force ?? "").toLowerCase() === "true";

      if (!force) {
        const matches = await findDuplicates(body.vendor_id, body.invoice_number);
        if (matches.length > 0) {
          // Hand-craft the problem document so we can embed the `matches`
          // array. HttpProblem's standard envelope doesn't carry arbitrary
          // metadata; the rest of the body still conforms to RFC 7807 and
          // the `code` field is what the client branches on.
          res
            .status(409)
            .type("application/problem+json")
            .json({
              type: "https://billpay.local/problems/possible-duplicate",
              title: "Possible duplicate bill",
              status: 409,
              code: "POSSIBLE_DUPLICATE",
              detail: `Found ${matches.length} other bill${matches.length === 1 ? "" : "s"} with the same invoice number for this vendor. Use ?force=true to create anyway.`,
              instance: req.originalUrl,
              matches,
            });
          return;
        }
      }

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

// GET /bills/check-duplicate — §6.10.3. Pre-flight for the create form.
// Idempotent, side-effect-free; the form calls it on blur of the invoice
// number field (with debouncing) so the user sees the warning before
// hitting Save. The actual server-side enforcement still happens on POST.
billsRouter.get(
  "/bills/check-duplicate",
  validate(checkDuplicateQuerySchema, "query"),
  async (req, res, next) => {
    try {
      const q = req.query as unknown as typeof checkDuplicateQuerySchema._output;
      const matches = await findDuplicates(q.vendor_id, q.invoice_number);
      res.json({ matches });
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

// POST /bills/extract — §6.10.1. Run OCR / structured extraction over an
// already-uploaded attachment and return the suggested fields. The route
// itself is dumb — all business logic lives in services/ocr.ts (LLM call,
// stub fallback, schema validation). Returns 200 even on stub fallback;
// the response body's `source` field tells the UI which path executed.
billsRouter.post(
  "/bills/extract",
  validate(billExtractRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as typeof billExtractRequestSchema._output;
      const result = await extractFromAttachment(body.attachment_id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  },
);

// §6.10.2 — bulk operations.
//
// Both bulk endpoints follow the same shape: validate the request, dispatch
// each bill_id to the existing single-bill service, and collect outcomes
// into a per-bill result envelope. Each bill is processed in its own
// transaction (the underlying services already wrap their state mutations)
// so a failure on bill N does NOT roll back bills 1..N-1. The HTTP status
// is always 200 — partial success is the *expected* shape, encoded in the
// response body, not as a 4xx/5xx.
//
// We intentionally process serially. Parallel execution would be marginally
// faster but the rules engine + idempotency + audit log all touch shared
// rows; serializing avoids surprising deadlocks for negligible latency
// cost on the demo's typical batch size (≤ a handful of bills).

function buildBulkSummary(results: BulkBillResult[]): BulkBillsResponse {
  let succeeded = 0;
  let failed = 0;
  for (const r of results) {
    if (r.ok) succeeded++;
    else failed++;
  }
  return { results, succeeded, failed };
}

// Maps any thrown error into the wire-format failure entry. HttpProblem
// carries a structured code; everything else collapses to INTERNAL.
function toBulkFailure(billId: string, err: unknown): BulkBillResult {
  if (err instanceof HttpProblem) {
    return {
      bill_id: billId,
      ok: false,
      code: err.code,
      detail: err.detail ?? err.title ?? "Failed",
    };
  }
  return {
    bill_id: billId,
    ok: false,
    code: "INTERNAL",
    detail: err instanceof Error ? err.message : "Failed",
  };
}

// POST /bills/bulk-approve — invoke approveBillT5T6 per bill_id. The
// underlying service enforces the spec's eligibility rules (rule
// snapshot, per-user limit, admin override), so we don't have to.
billsRouter.post(
  "/bills/bulk-approve",
  validate(bulkBillsRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as typeof bulkBillsRequestSchema._output;
      const results: BulkBillResult[] = [];
      for (const billId of body.bill_ids) {
        try {
          await approveBillT5T6(req.user!, billId, req.realUser!);
          results.push({ bill_id: billId, ok: true });
        } catch (err) {
          results.push(toBulkFailure(billId, err));
        }
      }
      res.json(buildBulkSummary(results));
    } catch (err) {
      next(err);
    }
  },
);

// POST /bills/bulk-pay — pay each bill via its vendor's default payment
// method (snapshotted by the existing payBill service). No idempotency
// key threading: the bulk endpoint is itself the idempotency boundary —
// callers should NOT retry an in-flight bulk-pay; resubmit the *failed*
// subset instead, surfaced via the per-bill result envelope.
billsRouter.post(
  "/bills/bulk-pay",
  validate(bulkBillsRequestSchema),
  async (req, res, next) => {
    try {
      const body = req.body as typeof bulkBillsRequestSchema._output;
      const results: BulkBillResult[] = [];
      for (const billId of body.bill_ids) {
        try {
          await payBill(req.user!, billId, null, req.realUser!);
          results.push({ bill_id: billId, ok: true });
        } catch (err) {
          results.push(toBulkFailure(billId, err));
        }
      }
      res.json(buildBulkSummary(results));
    } catch (err) {
      next(err);
    }
  },
);
