// §6.4 — Approval rules engine.
//
// Literal translation of §6.4.2 and §6.4.3 pseudocode. Function names match
// the spec where possible (`evaluateRules`, `computeEligiblePool`,
// `approveBill`, `rejectBill`) per the §9.2 T-R2 mitigation.
//
// Also implements:
//  - §6.4.4 default-rule invariant (V6, post-mutation check)
//  - §6.4.5 one-click-decides-all-eligible + rejection cascade
//  - §6.4.6 V1–V7 validation for rule create/update/delete
//  - §6.3.4.1 admin union at submission; admin override at decision time.

import type {
  ApprovalRule,
  Bill,
  BillApproval,
  Prisma,
  User,
} from "@prisma/client";
import { HttpProblem } from "../lib/problem.js";
import { emitBillEvent } from "./audit-log.js";
import { notifyBillApproved, notifyBillRejected } from "./notifications.js";

// ---------------------------------------------------------------------------
// §6.4.3 — Eligible approver pool computation.
//
// Union of (regular approvers filtered by amount limit) and (all active
// admins). Admins are added unconditionally — the limit filter does NOT
// apply to them per §6.3.4.1.
// ---------------------------------------------------------------------------
export function computeEligiblePool(
  rule: Pick<ApprovalRule, "approverUserIds">,
  bill: Pick<Bill, "amountCents">,
  activeUsers: readonly User[],
): string[] {
  const byId = new Map(activeUsers.map((u) => [u.id, u] as const));

  const regular = new Set<string>();
  for (const uid of rule.approverUserIds) {
    const u = byId.get(uid);
    if (!u || !u.isActive) continue;
    if (u.maxApprovalAmountCents >= bill.amountCents) regular.add(uid);
  }

  const admins = new Set<string>();
  for (const u of activeUsers) {
    if (u.role === "admin" && u.isActive) admins.add(u.id);
  }

  const union = new Set<string>([...regular, ...admins]);
  return [...union];
}

// Preview-only variant: the sample amount is explicit, and we return the two
// disjoint lists for the UI.
export function computeEligiblePoolPreview(
  approverUserIds: readonly string[],
  sampleAmountCents: number,
  activeUsers: readonly User[],
): { regular: User[]; admin: User[] } {
  const byId = new Map(activeUsers.map((u) => [u.id, u] as const));
  const regular: User[] = [];
  for (const uid of approverUserIds) {
    const u = byId.get(uid);
    if (!u || !u.isActive) continue;
    if (u.maxApprovalAmountCents >= sampleAmountCents) regular.push(u);
  }
  const admin = activeUsers.filter((u) => u.role === "admin" && u.isActive);
  return { regular, admin };
}

// ---------------------------------------------------------------------------
// §6.4.2 — Rule evaluation at T4 submission.
//
// Runs inside the submit() Prisma transaction. Throws
// SUBMISSION_PRECONDITION_FAILED (400) on no-matching-rule or
// no-eligible-approver. Side-effect: inserts N BillApproval rows.
// ---------------------------------------------------------------------------
export async function evaluateRules(
  tx: Prisma.TransactionClient,
  bill: Bill,
): Promise<BillApproval[]> {
  const activeRules = await tx.approvalRule.findMany({
    where: { isActive: true, minAmountCents: { lte: bill.amountCents } },
    orderBy: { createdAt: "asc" },
  });

  if (activeRules.length === 0) {
    throw new HttpProblem({
      status: 400,
      code: "SUBMISSION_PRECONDITION_FAILED",
      title: "Submission preconditions not met",
      detail:
        "No active approval rule matches this bill. Contact admin.",
      fieldIssues: [
        {
          path: "preconditions",
          message: "no_matching_rule",
        },
      ],
    });
  }

  const activeUsers = await tx.user.findMany({ where: { isActive: true } });

  const created: BillApproval[] = [];
  for (const rule of activeRules) {
    const eligible = computeEligiblePool(rule, bill, activeUsers);
    if (eligible.length === 0) {
      throw new HttpProblem({
        status: 400,
        code: "SUBMISSION_PRECONDITION_FAILED",
        title: "Submission preconditions not met",
        detail: `Rule '${rule.name}' has no approver who can sign off on this amount.`,
        fieldIssues: [
          {
            path: "preconditions",
            message: "no_eligible_approver_for_rule",
          },
        ],
      });
    }
    const row = await tx.billApproval.create({
      data: {
        billId: bill.id,
        ruleId: rule.id,
        ruleNameSnapshot: rule.name,
        eligibleApproverUserIds: eligible,
        status: "pending",
      },
    });
    created.push(row);
  }
  return created;
}

// ---------------------------------------------------------------------------
// §6.4.5 — Admin override flag helper.
//
// Per spec note: uses the CURRENT rule's approverUserIds (not the snapshot),
// because override-ness is an audit nicety, not an authorization decision.
// ---------------------------------------------------------------------------
export async function isAdminOverride(
  tx: Prisma.TransactionClient,
  user: Pick<User, "id" | "role">,
  slot: Pick<BillApproval, "ruleId">,
): Promise<boolean> {
  if (user.role !== "admin") return false;
  const rule = await tx.approvalRule.findUnique({
    where: { id: slot.ruleId },
    select: { approverUserIds: true },
  });
  if (!rule) return true; // rule deleted; admin is by definition outside the list
  return !rule.approverUserIds.includes(user.id);
}

// ---------------------------------------------------------------------------
// §6.4.5 — approveBill: decide all eligible pending slots in one transaction.
//
// Emits one "approved" per-approval event per decided slot, and (if the bill
// fully approves) one additional bill-level "approved" event (§6.3.5 T6).
// Throws NOT_ELIGIBLE_APPROVER / SELF_APPROVAL_FORBIDDEN per §6.3.4 / §6.3.4.1.
//
// `realUser` (defaults to `actingUser`) lets the audit log record the
// REAL admin behind an impersonation session — see services/audit-log.ts.
// ---------------------------------------------------------------------------
export async function approveBill(
  tx: Prisma.TransactionClient,
  bill: Bill,
  actingUser: User,
  realUser: User = actingUser,
): Promise<void> {
  const pending = await tx.billApproval.findMany({
    where: { billId: bill.id, status: "pending" },
    orderBy: { createdAt: "asc" },
  });

  const eligibleSlots = pending.filter((a) =>
    a.eligibleApproverUserIds.includes(actingUser.id),
  );
  if (eligibleSlots.length === 0) {
    throw new HttpProblem({
      status: 403,
      code: "NOT_ELIGIBLE_APPROVER",
      title: "Not an eligible approver",
      detail: "You are not in any pending approval's eligible pool for this bill.",
    });
  }

  // Self-approval forbidden for non-admins (§6.3.4.1 allows admins).
  if (
    actingUser.id === bill.createdByUserId &&
    actingUser.role !== "admin"
  ) {
    throw new HttpProblem({
      status: 403,
      code: "SELF_APPROVAL_FORBIDDEN",
      title: "Self-approval forbidden",
      detail: "You cannot approve a bill you created.",
    });
  }

  const now = new Date();
  for (const slot of eligibleSlots) {
    await tx.billApproval.update({
      where: { id: slot.id },
      data: {
        status: "approved",
        decidedByUserId: actingUser.id,
        decidedAt: now,
      },
    });
    const adminOverride = await isAdminOverride(tx, actingUser, slot);
    const payload: Record<string, unknown> = {
      rule_id: slot.ruleId,
      approval_id: slot.id,
      from_status: "pending_approval",
      to_status: "pending_approval",
    };
    if (adminOverride) payload.admin_override = true;
    await emitBillEvent(tx, {
      billId: bill.id,
      eventType: "approved",
      actor: actingUser,
      realUser,
      payload,
      occurredAt: now,
    });
  }

  // Any still-pending approval? If not, T6 fires.
  const remaining = await tx.billApproval.count({
    where: { billId: bill.id, status: "pending" },
  });
  if (remaining === 0) {
    await tx.bill.update({
      where: { id: bill.id },
      data: { status: "approved" },
    });
    await emitBillEvent(tx, {
      billId: bill.id,
      eventType: "approved",
      actor: actingUser,
      realUser,
      payload: {
        rule_id: null,
        approval_id: null,
        from_status: "pending_approval",
        to_status: "approved",
      },
      // Use a slightly later timestamp so ordering in the events list is
      // deterministic (bill-level event comes AFTER the per-approval events).
      occurredAt: new Date(now.getTime() + 1),
    });
    // §6.10.4 — notify the creator the bill has fully approved.
    await notifyBillApproved(tx, bill);
  }
}

// ---------------------------------------------------------------------------
// §6.4.5 — rejectBill: one rejection fails the whole bill; cascade other
// pending approvals to cancelled (silently, no events).
//
// `realUser` (defaults to `actingUser`) lets the audit log record the
// REAL admin behind an impersonation session — see services/audit-log.ts.
// ---------------------------------------------------------------------------
export async function rejectBill(
  tx: Prisma.TransactionClient,
  bill: Bill,
  actingUser: User,
  targetApprovalId: string,
  reason: string | null,
  realUser: User = actingUser,
): Promise<void> {
  const target = await tx.billApproval.findUnique({
    where: { id: targetApprovalId },
  });
  if (!target || target.billId !== bill.id) {
    throw new HttpProblem({
      status: 404,
      code: "NOT_FOUND",
      title: "Approval not found",
      detail: "No BillApproval matches that id on this bill.",
    });
  }
  if (target.status !== "pending") {
    throw new HttpProblem({
      status: 409,
      code: "ALREADY_DECIDED",
      title: "Approval already decided",
      detail: "This approval has already been decided and cannot be changed.",
    });
  }
  if (!target.eligibleApproverUserIds.includes(actingUser.id) && actingUser.role !== "admin") {
    throw new HttpProblem({
      status: 403,
      code: "NOT_ELIGIBLE_APPROVER",
      title: "Not an eligible approver",
      detail: "You are not in this approval's eligible pool.",
    });
  }
  if (
    actingUser.id === bill.createdByUserId &&
    actingUser.role !== "admin"
  ) {
    throw new HttpProblem({
      status: 403,
      code: "SELF_APPROVAL_FORBIDDEN",
      title: "Self-rejection forbidden",
      detail: "You cannot reject a bill you created.",
    });
  }

  const now = new Date();
  await tx.billApproval.update({
    where: { id: target.id },
    data: {
      status: "rejected",
      decidedByUserId: actingUser.id,
      decidedAt: now,
      rejectionReason: reason ?? null,
    },
  });

  // Cascade OTHER pending approvals to cancelled (silent, no events).
  await tx.billApproval.updateMany({
    where: { billId: bill.id, id: { not: target.id }, status: "pending" },
    data: {
      status: "cancelled",
      decidedAt: now,
      // decidedByUserId stays null (system cascade)
      // rejectionReason stays null
    },
  });

  const billRejectionReason = reason ?? `Rejected by ${actingUser.name}`;
  await tx.bill.update({
    where: { id: bill.id },
    data: { status: "rejected", rejectionReason: billRejectionReason },
  });

  const adminOverride = await isAdminOverride(tx, actingUser, target);
  const payload: Record<string, unknown> = {
    rule_id: target.ruleId,
    approval_id: target.id,
    rejection_reason: reason,
  };
  if (adminOverride) payload.admin_override = true;
  await emitBillEvent(tx, {
    billId: bill.id,
    eventType: "rejected",
    actor: actingUser,
    realUser,
    payload,
    occurredAt: now,
  });

  // §6.10.4 — notify the creator with the rejection reason inline.
  await notifyBillRejected(tx, bill, reason);
}

// ---------------------------------------------------------------------------
// §6.4.6 — Rule create/update validation (V1–V5).
//
// V1–V3 are mostly handled by zod, but we re-check them here so the API
// surfaces the canonical `code` string on each failure instead of a generic
// VALIDATION_ERROR. V4 and V5 require DB lookups.
//
// The V1–V5 codes are exposed via field_issues[].path=="<field>", .message
// == "<CODE>" so callers can branch on a single stable string.
// ---------------------------------------------------------------------------
export interface RuleValidationInput {
  name: string;
  minAmountCents: number;
  approverUserIds: string[];
  isActive: boolean;
}

export async function validateRuleAgainstV1toV5(
  tx: Prisma.TransactionClient,
  input: RuleValidationInput,
): Promise<void> {
  if (
    typeof input.name !== "string" ||
    input.name.trim() === "" ||
    input.name.length > 100
  ) {
    throw new HttpProblem({
      status: 400,
      code: "INVALID_NAME",
      title: "Invalid rule name",
      detail: "name must be a non-empty string of at most 100 chars.",
      fieldIssues: [{ path: "name", message: "INVALID_NAME" }],
    });
  }
  if (!Number.isInteger(input.minAmountCents) || input.minAmountCents < 0) {
    throw new HttpProblem({
      status: 400,
      code: "INVALID_THRESHOLD",
      title: "Invalid min_amount_cents",
      detail: "min_amount_cents must be a non-negative integer.",
      fieldIssues: [{ path: "min_amount_cents", message: "INVALID_THRESHOLD" }],
    });
  }
  if (!Array.isArray(input.approverUserIds) || input.approverUserIds.length === 0) {
    throw new HttpProblem({
      status: 400,
      code: "EMPTY_APPROVER_POOL",
      title: "Empty approver pool",
      detail: "approver_user_ids must be a non-empty array.",
      fieldIssues: [{ path: "approver_user_ids", message: "EMPTY_APPROVER_POOL" }],
    });
  }

  const users = await tx.user.findMany({
    where: { id: { in: input.approverUserIds } },
  });
  const active = new Set(users.filter((u) => u.isActive).map((u) => u.id));
  for (const uid of input.approverUserIds) {
    if (!active.has(uid)) {
      throw new HttpProblem({
        status: 400,
        code: "UNKNOWN_OR_INACTIVE_USER",
        title: "Unknown or inactive user",
        detail: `User '${uid}' is unknown or not active.`,
        fieldIssues: [
          { path: "approver_user_ids", message: "UNKNOWN_OR_INACTIVE_USER" },
        ],
      });
    }
  }

  // V5: at least one regular user in the proposed pool must have a limit that
  // covers min_amount_cents (admins are NOT sufficient — see §6.4.6 note).
  const qualifies = users.some(
    (u) =>
      u.isActive &&
      input.approverUserIds.includes(u.id) &&
      u.maxApprovalAmountCents >= input.minAmountCents,
  );
  if (!qualifies) {
    throw new HttpProblem({
      status: 400,
      code: "NO_QUALIFIED_APPROVER",
      title: "No qualified approver",
      detail:
        "At least one user in approver_user_ids must have max_approval_amount_cents >= min_amount_cents.",
      fieldIssues: [
        { path: "approver_user_ids", message: "NO_QUALIFIED_APPROVER" },
      ],
    });
  }
}

// ---------------------------------------------------------------------------
// §6.4.4 / V6 — post-mutation default-rule invariant.
//
// Call this inside the same transaction that mutated a rule (create / update
// / delete). Throws 409 DEFAULT_RULE_REQUIRED if zero active rules with
// min_amount_cents = 0 remain.
// ---------------------------------------------------------------------------
export async function assertDefaultRuleInvariant(
  tx: Prisma.TransactionClient,
): Promise<void> {
  const count = await tx.approvalRule.count({
    where: { isActive: true, minAmountCents: 0 },
  });
  if (count < 1) {
    throw new HttpProblem({
      status: 409,
      code: "DEFAULT_RULE_REQUIRED",
      title: "Default rule required",
      detail:
        "At least one active rule with min_amount_cents = 0 must exist. Create a replacement before removing the last default.",
    });
  }
}
