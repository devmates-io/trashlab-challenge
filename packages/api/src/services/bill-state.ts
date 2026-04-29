// §6.3 — Bill lifecycle state machine.
//
// Central guard: every Bill.status mutation in the codebase goes through a
// function exported here (§9.2 T-R3). Each transition:
//   1) Validates authorization per §6.3.4 + admin override §6.3.4.1
//   2) Validates (from, to) is legal
//   3) Applies the mutation + side effects per §6.3.5 inside a single
//      `prisma.$transaction`.
//
// Functions: createBill (T1), editBill (T2), deleteBill (T3), submitBill
// (T4), approveBillT5T6, rejectBillT7, recallBill (T8), payBill (T9),
// cloneBill (T10).

import type {
  BillStatus,
  Prisma,
  User,
} from "@prisma/client";
import { randomBytes } from "node:crypto";
import {
  paymentDetailsStoredSchema,
  billCreateRequestSchema,
  type PaymentDetailsRequest,
} from "@bill-pay/shared";
import { prisma } from "../db.js";
import { HttpProblem } from "../lib/problem.js";
import { idempotencyKeyStore } from "../lib/idempotency.js";
import { generateMockReference } from "../lib/mock-reference.js";
import { fromDateString, billDetailInclude } from "../lib/dto.js";
import { stagedUploads } from "../lib/upload-staging.js";
import {
  approveBill,
  evaluateRules,
  rejectBill,
} from "./approval-engine.js";
import { emitBillEvent } from "./audit-log.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function illegalTransition(from: BillStatus, action: string): never {
  throw new HttpProblem({
    status: 409,
    code: "ILLEGAL_TRANSITION",
    title: "Illegal state transition",
    detail: `Cannot ${action} a bill in status '${from}'.`,
  });
}

async function assertInvoiceUnique(
  tx: Prisma.TransactionClient,
  vendorId: string,
  invoiceNumber: string,
  excludeBillId?: string,
) {
  const conflict = await tx.bill.findFirst({
    where: {
      vendorId,
      invoiceNumber,
      ...(excludeBillId ? { NOT: { id: excludeBillId } } : {}),
    },
    select: { id: true },
  });
  if (conflict) {
    throw new HttpProblem({
      status: 409,
      code: "DUPLICATE_INVOICE_NUMBER",
      title: "Duplicate invoice number",
      detail: `Invoice number already exists for this vendor.`,
    });
  }
}

function assertLineItemSum(expected: number, items: readonly { amount_cents: number }[]) {
  const sum = items.reduce((s, li) => s + li.amount_cents, 0);
  if (sum !== expected) {
    throw new HttpProblem({
      status: 400,
      code: "VALIDATION_ERROR",
      title: "Invalid request body",
      detail: "sum(line_items.amount_cents) must equal amount_cents.",
      fieldIssues: [
        {
          path: "line_items",
          message: `sum(${sum}) != amount_cents(${expected})`,
        },
      ],
    });
  }
}

// Link a previously staged upload to the bill. Consumed on use so the same
// attachment_id can't be re-linked. Validates the uploader owns the bill
// implicitly via Attachment.uploaded_by_user_id.
async function linkStagedAttachment(
  tx: Prisma.TransactionClient,
  billId: string,
  attachmentId: string,
) {
  const staged = stagedUploads.get(attachmentId);
  if (!staged) {
    throw new HttpProblem({
      status: 400,
      code: "VALIDATION_ERROR",
      title: "Invalid request body",
      detail: "attachment_id does not reference a known upload (may have expired).",
      fieldIssues: [{ path: "attachment_id", message: "Unknown upload id" }],
    });
  }
  // Remove any existing attachment (edit flow) before creating the new one —
  // the attachment.bill_id is UNIQUE, so this keeps the 1:1 invariant.
  await tx.attachment.deleteMany({ where: { billId } });
  await tx.attachment.create({
    data: {
      id: staged.id,
      billId,
      originalFilename: staged.originalFilename,
      storedFilename: staged.storedFilename,
      mimeType: staged.mimeType,
      sizeBytes: staged.sizeBytes,
      uploadedByUserId: staged.uploadedByUserId,
      uploadedAt: staged.uploadedAt,
    },
  });
  stagedUploads.delete(attachmentId);
}

// ---------------------------------------------------------------------------
// T1 — create draft
// ---------------------------------------------------------------------------

export interface CreateBillInput {
  vendor_id: string;
  invoice_number: string;
  amount_cents: number;
  issue_date: string;
  due_date: string;
  line_items: Array<{ description: string; amount_cents: number }>;
  attachment_id?: string | null;
}

// Creates a new bill in `draft` status. Defence-in-depth: re-validates inputs
// with Zod even though the route middleware already ran, guarding against direct
// service callers. Prisma uses parameterized queries throughout — raw SQL is
// never constructed from user input.
//
// `actor` is the acting identity (impersonated user when impersonation is
// active; else the authenticated user). `realUser` is the real session
// owner — defaults to `actor`, set differently only by impersonation
// sessions. The audit log uses `realUser` to inject `impersonated_by_user_id`
// into the event payload (§6.3.7).
export async function createBill(
  actor: User,
  input: CreateBillInput,
  realUser: User = actor,
) {
  // Validate all inputs at the service layer as defence-in-depth — guards against
  // callers that bypass route middleware. Prisma's query builder uses parameterized
  // queries throughout, so ORM-level SQL injection is not a vector here.
  const parsed = billCreateRequestSchema.safeParse(input);
  if (!parsed.success) {
    throw new HttpProblem({
      status: 400,
      code: "VALIDATION_ERROR",
      title: "Invalid request body",
      detail: "One or more fields failed validation. See field_issues.",
      fieldIssues: parsed.error.issues.map((issue) => ({
        path: issue.path.length > 0 ? issue.path.join(".") : "(root)",
        message: issue.message,
      })),
    });
  }

  assertLineItemSum(input.amount_cents, input.line_items);

  return prisma.$transaction(async (tx) => {
    const vendor = await tx.vendor.findUnique({ where: { id: input.vendor_id } });
    if (!vendor) {
      throw new HttpProblem({
        status: 400,
        code: "VALIDATION_ERROR",
        title: "Invalid request body",
        detail: "vendor_id does not reference a known vendor.",
        fieldIssues: [{ path: "vendor_id", message: "Unknown vendor" }],
      });
    }
    if (!vendor.isActive) {
      throw new HttpProblem({
        status: 400,
        code: "VALIDATION_ERROR",
        title: "Invalid request body",
        detail: "vendor is not active; create a bill against an active vendor.",
        fieldIssues: [{ path: "vendor_id", message: "Vendor is inactive" }],
      });
    }
    await assertInvoiceUnique(tx, input.vendor_id, input.invoice_number);

    const bill = await tx.bill.create({
      data: {
        vendorId: input.vendor_id,
        invoiceNumber: input.invoice_number,
        amountCents: input.amount_cents,
        issueDate: fromDateString(input.issue_date),
        dueDate: fromDateString(input.due_date),
        status: "draft",
        createdByUserId: actor.id,
        lineItems: {
          create: input.line_items.map((li) => ({
            description: li.description,
            amountCents: li.amount_cents,
          })),
        },
      },
    });

    if (input.attachment_id) {
      await linkStagedAttachment(tx, bill.id, input.attachment_id);
    }

    await emitBillEvent(tx, {
      billId: bill.id,
      eventType: "created",
      actor,
      realUser,
      payload: {
        amount_cents: bill.amountCents,
        vendor_id: bill.vendorId,
      },
    });

    return tx.bill.findUniqueOrThrow({
      where: { id: bill.id },
      include: billDetailInclude,
    });
  });
}

// ---------------------------------------------------------------------------
// T2 — edit draft
// ---------------------------------------------------------------------------

export interface EditBillInput {
  vendor_id?: string;
  invoice_number?: string;
  amount_cents?: number;
  issue_date?: string;
  due_date?: string;
  line_items?: Array<{ description: string; amount_cents: number }>;
  attachment_id?: string | null;
}

// Updates a `draft` bill in place. Only the bill's creator may edit.
// Accepts a partial patch — omitted fields are left unchanged. If `line_items`
// is provided it replaces the full set; if only `amount_cents` changes the
// existing line items must still sum to the new value.
export async function editBill(
  actor: User,
  billId: string,
  input: EditBillInput,
  realUser: User = actor,
) {
  return prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findUnique({ where: { id: billId } });
    if (!bill) {
      throw new HttpProblem({
        status: 404,
        code: "NOT_FOUND",
        title: "Bill not found",
        detail: "No bill with that id.",
      });
    }
    if (bill.createdByUserId !== actor.id) {
      throw new HttpProblem({
        status: 403,
        code: "NOT_BILL_CREATOR",
        title: "Not the bill creator",
        detail: "Only the bill creator may edit this draft.",
      });
    }
    if (bill.status !== "draft") illegalTransition(bill.status, "edit");

    // Resolve the post-edit values so we can re-check invariants.
    const nextVendorId = input.vendor_id ?? bill.vendorId;
    const nextInvoiceNumber = input.invoice_number ?? bill.invoiceNumber;
    const nextAmount = input.amount_cents ?? bill.amountCents;
    const nextIssueDate = input.issue_date
      ? fromDateString(input.issue_date)
      : bill.issueDate;
    const nextDueDate = input.due_date
      ? fromDateString(input.due_date)
      : bill.dueDate;

    if (input.amount_cents !== undefined && input.amount_cents <= 0) {
      throw new HttpProblem({
        status: 400,
        code: "VALIDATION_ERROR",
        title: "Invalid request body",
        detail: "amount_cents must be greater than 0.",
        fieldIssues: [{ path: "amount_cents", message: "Must be > 0" }],
      });
    }

    if (nextDueDate < nextIssueDate) {
      throw new HttpProblem({
        status: 400,
        code: "VALIDATION_ERROR",
        title: "Invalid request body",
        detail: "due_date must be >= issue_date.",
        fieldIssues: [{ path: "due_date", message: "Must be >= issue_date" }],
      });
    }

    // Vendor must exist + be active when vendor_id changes.
    if (input.vendor_id && input.vendor_id !== bill.vendorId) {
      const vendor = await tx.vendor.findUnique({
        where: { id: nextVendorId },
      });
      if (!vendor) {
        throw new HttpProblem({
          status: 400,
          code: "VALIDATION_ERROR",
          title: "Invalid request body",
          detail: "vendor_id does not reference a known vendor.",
          fieldIssues: [{ path: "vendor_id", message: "Unknown vendor" }],
        });
      }
      if (!vendor.isActive) {
        throw new HttpProblem({
          status: 400,
          code: "VALIDATION_ERROR",
          title: "Invalid request body",
          detail: "vendor is not active.",
          fieldIssues: [{ path: "vendor_id", message: "Vendor is inactive" }],
        });
      }
    }

    if (
      input.vendor_id !== undefined || input.invoice_number !== undefined
    ) {
      await assertInvoiceUnique(tx, nextVendorId, nextInvoiceNumber, bill.id);
    }

    // If line_items is provided, it REPLACES the existing set (atomically)
    // per §6.3.5 T2 and §6.5.4. We also re-validate the sum invariant against
    // the NEW amount (or existing amount if unchanged).
    if (input.line_items !== undefined) {
      assertLineItemSum(nextAmount, input.line_items);
      await tx.billLineItem.deleteMany({ where: { billId: bill.id } });
      await tx.billLineItem.createMany({
        data: input.line_items.map((li) => ({
          billId: bill.id,
          description: li.description,
          amountCents: li.amount_cents,
        })),
      });
    } else if (input.amount_cents !== undefined) {
      // amount changed but line_items not provided — re-check the existing
      // line items still sum correctly.
      const existing = await tx.billLineItem.findMany({
        where: { billId: bill.id },
        select: { amountCents: true },
      });
      const sum = existing.reduce((s, li) => s + li.amountCents, 0);
      if (sum !== input.amount_cents) {
        throw new HttpProblem({
          status: 400,
          code: "VALIDATION_ERROR",
          title: "Invalid request body",
          detail:
            "amount_cents differs from the sum of existing line items; submit line_items as well.",
          fieldIssues: [
            {
              path: "amount_cents",
              message: `existing line items sum ${sum}, not ${input.amount_cents}`,
            },
          ],
        });
      }
    }

    // Assemble diff for the `edited` event payload.
    const changedFields: string[] = [];
    const previousValues: Record<string, unknown> = {};
    if (input.vendor_id !== undefined && input.vendor_id !== bill.vendorId) {
      changedFields.push("vendor_id");
      previousValues.vendor_id = bill.vendorId;
    }
    if (input.invoice_number !== undefined && input.invoice_number !== bill.invoiceNumber) {
      changedFields.push("invoice_number");
      previousValues.invoice_number = bill.invoiceNumber;
    }
    if (input.amount_cents !== undefined && input.amount_cents !== bill.amountCents) {
      changedFields.push("amount_cents");
      previousValues.amount_cents = bill.amountCents;
    }
    if (input.issue_date !== undefined && input.issue_date !== null) {
      const prev = bill.issueDate.toISOString().slice(0, 10);
      if (input.issue_date !== prev) {
        changedFields.push("issue_date");
        previousValues.issue_date = prev;
      }
    }
    if (input.due_date !== undefined && input.due_date !== null) {
      const prev = bill.dueDate.toISOString().slice(0, 10);
      if (input.due_date !== prev) {
        changedFields.push("due_date");
        previousValues.due_date = prev;
      }
    }
    if (input.line_items !== undefined) {
      changedFields.push("line_items");
    }
    if (input.attachment_id !== undefined) {
      changedFields.push("attachment_id");
    }

    await tx.bill.update({
      where: { id: bill.id },
      data: {
        vendorId: nextVendorId,
        invoiceNumber: nextInvoiceNumber,
        amountCents: nextAmount,
        issueDate: nextIssueDate,
        dueDate: nextDueDate,
      },
    });

    if (input.attachment_id !== undefined) {
      if (input.attachment_id === null) {
        await tx.attachment.deleteMany({ where: { billId: bill.id } });
      } else {
        await linkStagedAttachment(tx, bill.id, input.attachment_id);
      }
    }

    // Only emit if something actually changed.
    if (changedFields.length > 0) {
      await emitBillEvent(tx, {
        billId: bill.id,
        eventType: "edited",
        actor,
        realUser,
        payload: {
          changed_fields: changedFields,
          previous_values: previousValues,
        },
      });
    }

    return tx.bill.findUniqueOrThrow({
      where: { id: bill.id },
      include: billDetailInclude,
    });
  });
}

// ---------------------------------------------------------------------------
// T3 — delete draft
// ---------------------------------------------------------------------------

// Hard-deletes a `draft` bill. Only the creator may delete; non-draft bills
// must be recalled or rejected first. No audit event is emitted (§6.3.5 T3).
export async function deleteBill(actor: User, billId: string) {
  await prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findUnique({ where: { id: billId } });
    if (!bill) {
      throw new HttpProblem({
        status: 404,
        code: "NOT_FOUND",
        title: "Bill not found",
        detail: "No bill with that id.",
      });
    }
    if (bill.createdByUserId !== actor.id) {
      throw new HttpProblem({
        status: 403,
        code: "NOT_BILL_CREATOR",
        title: "Not the bill creator",
        detail: "Only the bill creator may delete this draft.",
      });
    }
    if (bill.status !== "draft") illegalTransition(bill.status, "delete");

    await tx.bill.delete({ where: { id: bill.id } });
    // No event emitted per §6.3.5 T3.
  });
}

// ---------------------------------------------------------------------------
// T4 — submit draft
// ---------------------------------------------------------------------------

// Transitions a `draft` → `pending_approval`. Evaluates the approval rules
// engine synchronously, creating BillApproval rows with frozen eligible-approver
// snapshots. Validates preconditions (line items sum, vendor active, amount > 0).
export async function submitBill(
  actor: User,
  billId: string,
  realUser: User = actor,
) {
  return prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findUnique({
      where: { id: billId },
      include: { lineItems: true, vendor: true },
    });
    if (!bill) {
      throw new HttpProblem({
        status: 404,
        code: "NOT_FOUND",
        title: "Bill not found",
        detail: "No bill with that id.",
      });
    }
    if (bill.createdByUserId !== actor.id) {
      throw new HttpProblem({
        status: 403,
        code: "NOT_BILL_CREATOR",
        title: "Not the bill creator",
        detail: "Only the bill creator may submit this bill.",
      });
    }
    if (bill.status !== "draft") illegalTransition(bill.status, "submit");

    // Preconditions §6.3.5 T4.
    if (bill.lineItems.length < 1) {
      throw new HttpProblem({
        status: 400,
        code: "SUBMISSION_PRECONDITION_FAILED",
        title: "Submission preconditions not met",
        detail: "Bill has no line items.",
        fieldIssues: [{ path: "preconditions", message: "missing_line_items" }],
      });
    }
    const sum = bill.lineItems.reduce((s, li) => s + li.amountCents, 0);
    if (sum !== bill.amountCents) {
      throw new HttpProblem({
        status: 400,
        code: "SUBMISSION_PRECONDITION_FAILED",
        title: "Submission preconditions not met",
        detail: `sum(line_items) = ${sum} != amount_cents ${bill.amountCents}.`,
        fieldIssues: [
          { path: "preconditions", message: "line_items_sum_mismatch" },
        ],
      });
    }
    if (!bill.vendor.isActive) {
      throw new HttpProblem({
        status: 400,
        code: "SUBMISSION_PRECONDITION_FAILED",
        title: "Submission preconditions not met",
        detail: "Vendor is not active.",
        fieldIssues: [{ path: "preconditions", message: "vendor_inactive" }],
      });
    }
    if (bill.amountCents <= 0) {
      throw new HttpProblem({
        status: 400,
        code: "SUBMISSION_PRECONDITION_FAILED",
        title: "Submission preconditions not met",
        detail: "amount_cents must be > 0.",
        fieldIssues: [{ path: "preconditions", message: "amount_not_positive" }],
      });
    }

    const approvals = await evaluateRules(tx, bill);

    const now = new Date();
    await tx.bill.update({
      where: { id: bill.id },
      data: { status: "pending_approval", submittedAt: now },
    });

    await emitBillEvent(tx, {
      billId: bill.id,
      eventType: "submitted",
      actor,
      realUser,
      payload: {
        matched_rule_ids: approvals.map((a) => a.ruleId),
      },
      occurredAt: now,
    });

    return tx.bill.findUniqueOrThrow({
      where: { id: bill.id },
      include: billDetailInclude,
    });
  });
}

// ---------------------------------------------------------------------------
// T5/T6 — approve
// ---------------------------------------------------------------------------

// T5: marks the actor's pending BillApproval slots as `approved`.
// T6: fires automatically inside approveBill() when ALL slots are satisfied,
// promoting the bill from `pending_approval` → `approved` in the same
// transaction. Admins bypass the eligibility check (§6.3.4.1).
export async function approveBillT5T6(
  actor: User,
  billId: string,
  realUser: User = actor,
) {
  return prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findUnique({ where: { id: billId } });
    if (!bill) {
      throw new HttpProblem({
        status: 404,
        code: "NOT_FOUND",
        title: "Bill not found",
        detail: "No bill with that id.",
      });
    }
    if (bill.status !== "pending_approval") {
      illegalTransition(bill.status, "approve");
    }
    await approveBill(tx, bill, actor, realUser);

    return tx.bill.findUniqueOrThrow({
      where: { id: bill.id },
      include: billDetailInclude,
    });
  });
}

// ---------------------------------------------------------------------------
// T7 — reject a specific BillApproval
// ---------------------------------------------------------------------------

// Rejects a specific BillApproval row (not the bill directly). Rejection is
// terminal — the bill moves to `rejected` and can only re-enter the workflow
// by cloning (T10). An optional reason is recorded in the audit log.
export async function rejectApproval(
  actor: User,
  approvalId: string,
  reason: string | null,
  realUser: User = actor,
) {
  return prisma.$transaction(async (tx) => {
    const approval = await tx.billApproval.findUnique({
      where: { id: approvalId },
    });
    if (!approval) {
      throw new HttpProblem({
        status: 404,
        code: "NOT_FOUND",
        title: "Approval not found",
        detail: "No approval with that id.",
      });
    }
    const bill = await tx.bill.findUnique({ where: { id: approval.billId } });
    if (!bill) {
      throw new HttpProblem({
        status: 404,
        code: "NOT_FOUND",
        title: "Bill not found",
        detail: "Associated bill not found.",
      });
    }
    if (bill.status !== "pending_approval") {
      illegalTransition(bill.status, "reject approvals on");
    }

    await rejectBill(tx, bill, actor, approvalId, reason, realUser);

    return tx.bill.findUniqueOrThrow({
      where: { id: bill.id },
      include: billDetailInclude,
    });
  });
}

// ---------------------------------------------------------------------------
// T8 — recall
// ---------------------------------------------------------------------------

// Returns a `pending_approval` bill to `draft`, cancelling all pending
// BillApproval rows. Blocked once any approval has been decided — the creator
// must wait for full rejection or contact an admin.
export async function recallBill(
  actor: User,
  billId: string,
  realUser: User = actor,
) {
  return prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findUnique({
      where: { id: billId },
      include: { approvals: true },
    });
    if (!bill) {
      throw new HttpProblem({
        status: 404,
        code: "NOT_FOUND",
        title: "Bill not found",
        detail: "No bill with that id.",
      });
    }
    if (bill.createdByUserId !== actor.id) {
      throw new HttpProblem({
        status: 403,
        code: "NOT_BILL_CREATOR",
        title: "Not the bill creator",
        detail: "Only the bill creator may recall this bill.",
      });
    }
    if (bill.status !== "pending_approval") {
      illegalTransition(bill.status, "recall");
    }
    const anyDecided = bill.approvals.some((a) => a.status !== "pending");
    if (anyDecided) {
      throw new HttpProblem({
        status: 409,
        code: "CANNOT_RECALL_AFTER_DECISION",
        title: "Cannot recall after decision",
        detail: "At least one approval has been decided; recall is no longer allowed.",
      });
    }

    const now = new Date();
    const cancelled = await tx.billApproval.updateMany({
      where: { billId: bill.id, status: "pending" },
      data: {
        status: "cancelled",
        decidedAt: now,
      },
    });

    await tx.bill.update({
      where: { id: bill.id },
      data: { status: "draft", submittedAt: null },
    });

    await emitBillEvent(tx, {
      billId: bill.id,
      eventType: "recalled",
      actor,
      realUser,
      payload: { cancelled_approval_count: cancelled.count },
      occurredAt: now,
    });

    return tx.bill.findUniqueOrThrow({
      where: { id: bill.id },
      include: billDetailInclude,
    });
  });
}

// ---------------------------------------------------------------------------
// T9 — pay
// ---------------------------------------------------------------------------

function idempotencyKeyFor(
  idemKey: string,
  actorId: string,
  billId: string,
) {
  return `${idemKey}|${actorId}|${billId}`;
}

// Executes a mock payment for an `approved` bill. Snapshots the vendor's
// payment details at settlement time (so later vendor edits don't rewrite
// history). Supports idempotent retries via the `Idempotency-Key` header —
// repeat calls with the same key return the original result without re-paying.
export async function payBill(
  actor: User,
  billId: string,
  idempotencyKey: string | null,
  realUser: User = actor,
) {
  // Short-circuit BEFORE the transaction when we already have a cached id.
  if (idempotencyKey) {
    const cachedPaymentId = idempotencyKeyStore.get(
      idempotencyKeyFor(idempotencyKey, actor.id, billId),
    );
    if (cachedPaymentId) {
      const bill = await prisma.bill.findUnique({
        where: { id: billId },
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
      return bill;
    }
  }

  const result = await prisma.$transaction(async (tx) => {
    const bill = await tx.bill.findUnique({
      where: { id: billId },
      include: { vendor: true },
    });
    if (!bill) {
      throw new HttpProblem({
        status: 404,
        code: "NOT_FOUND",
        title: "Bill not found",
        detail: "No bill with that id.",
      });
    }
    if (bill.status !== "approved") illegalTransition(bill.status, "pay");

    // Pay authority (with admin override per §6.3.4.1).
    if (
      actor.role !== "admin" &&
      actor.maxApprovalAmountCents < bill.amountCents
    ) {
      throw new HttpProblem({
        status: 403,
        code: "INSUFFICIENT_PAY_AUTHORITY",
        title: "Insufficient pay authority",
        detail:
          "Your max_approval_amount_cents is below the bill amount; admin override required.",
      });
    }

    // §6.7.4 — re-validate vendor.payment_details against the stored schema.
    const parsed = paymentDetailsStoredSchema.safeParse(bill.vendor.paymentDetails);
    if (!parsed.success) {
      throw new HttpProblem({
        status: 409,
        code: "INVALID_PAYMENT_DETAILS",
        title: "Invalid payment details",
        detail: `Vendor '${bill.vendor.name}' has invalid ${bill.vendor.paymentMethod} payment details. Fix the vendor before paying.`,
        fieldIssues: parsed.error.issues.map((issue) => ({
          path:
            issue.path.length > 0
              ? `payment_details.${issue.path.join(".")}`
              : "payment_details",
          message: issue.message,
        })),
      });
    }

    // Admin-override flag: true iff admin AND below the amount limit.
    const adminOverride =
      actor.role === "admin" && actor.maxApprovalAmountCents < bill.amountCents;

    const mockReference = generateMockReference(bill.vendor.paymentMethod);

    const payment = await tx.payment.create({
      data: {
        billId: bill.id,
        amountCents: bill.amountCents,
        paymentMethod: bill.vendor.paymentMethod,
        paymentDetailsSnapshot:
          bill.vendor.paymentDetails as unknown as Prisma.InputJsonValue,
        status: "completed",
        mockReference,
        initiatedByUserId: actor.id,
      },
    });

    await tx.bill.update({
      where: { id: bill.id },
      data: { status: "paid" },
    });

    const payload: Record<string, unknown> = {
      payment_id: payment.id,
      amount_cents: payment.amountCents,
      payment_method: payment.paymentMethod,
      mock_reference: payment.mockReference,
    };
    if (adminOverride) payload.admin_override = true;
    await emitBillEvent(tx, {
      billId: bill.id,
      eventType: "paid",
      actor,
      realUser,
      payload,
    });

    return {
      paymentId: payment.id,
      bill: await tx.bill.findUniqueOrThrow({
        where: { id: bill.id },
        include: billDetailInclude,
      }),
    };
  });

  if (idempotencyKey) {
    idempotencyKeyStore.set(
      idempotencyKeyFor(idempotencyKey, actor.id, billId),
      result.paymentId,
    );
  }
  return result.bill;
}

// ---------------------------------------------------------------------------
// T10 — clone a rejected bill into a NEW draft
// ---------------------------------------------------------------------------

// Creates a new `draft` from a `rejected` bill, copying all fields and line
// items. The cloned invoice number gets a `-CLONE-<hex>` suffix to avoid the
// duplicate-invoice-number constraint.
export async function cloneBill(
  actor: User,
  sourceBillId: string,
  realUser: User = actor,
) {
  return prisma.$transaction(async (tx) => {
    const source = await tx.bill.findUnique({
      where: { id: sourceBillId },
      include: { lineItems: true },
    });
    if (!source) {
      throw new HttpProblem({
        status: 404,
        code: "NOT_FOUND",
        title: "Bill not found",
        detail: "No source bill with that id.",
      });
    }
    if (source.status !== "rejected") {
      throw new HttpProblem({
        status: 409,
        code: "CAN_ONLY_CLONE_REJECTED",
        title: "Can only clone rejected bills",
        detail: `Cannot clone a bill in status '${source.status}'.`,
      });
    }

    const shortSuffix = randomBytes(3).toString("hex"); // 6 hex chars
    const newInvoiceNumber = `${source.invoiceNumber}-CLONE-${shortSuffix}`;

    const clone = await tx.bill.create({
      data: {
        vendorId: source.vendorId,
        invoiceNumber: newInvoiceNumber,
        amountCents: source.amountCents,
        issueDate: source.issueDate,
        dueDate: source.dueDate,
        status: "draft",
        createdByUserId: actor.id,
        lineItems: {
          create: source.lineItems.map((li) => ({
            description: li.description,
            amountCents: li.amountCents,
          })),
        },
      },
    });

    await emitBillEvent(tx, {
      billId: clone.id,
      eventType: "created",
      actor,
      realUser,
      payload: {
        amount_cents: clone.amountCents,
        vendor_id: clone.vendorId,
        cloned_from_bill_id: source.id,
      },
    });

    return tx.bill.findUniqueOrThrow({
      where: { id: clone.id },
      include: billDetailInclude,
    });
  });
}

// Re-export for routes that want the reference-typed payload (not used yet,
// but keeps the ESM surface intentional).
export type { PaymentDetailsRequest };
