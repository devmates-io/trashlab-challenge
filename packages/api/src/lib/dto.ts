// DTO helpers — map Prisma rows (camelCase) to the snake_case wire contract
// specified in §6.5.4. Every route composes BillSummaryDTO / BillDetailDTO /
// VendorDTO / etc. through these functions to keep the JSON boundary
// consistent.

import type {
  ApprovalRule,
  Attachment,
  Bill,
  BillApproval,
  BillEvent,
  BillLineItem,
  Payment,
  User,
  Vendor,
} from "@prisma/client";

// ---- date helpers ---------------------------------------------------------

// Bill.issueDate and Bill.dueDate are stored as `@db.Date`, i.e. midnight UTC
// of the calendar day. The wire format is `YYYY-MM-DD` (§6.5.1).
export function toDateString(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// Parse a `YYYY-MM-DD` string into midnight UTC. Zod already validates the
// shape in the request schemas, so this only runs on pre-validated strings.
export function fromDateString(s: string): Date {
  return new Date(`${s}T00:00:00.000Z`);
}

// ---- user -----------------------------------------------------------------

export function userToDto(u: User) {
  return {
    id: u.id,
    name: u.name,
    email: u.email ?? null,
    role: u.role,
    max_approval_amount_cents: u.maxApprovalAmountCents,
    is_active: u.isActive,
    created_at: u.createdAt.toISOString(),
    updated_at: u.updatedAt.toISOString(),
  };
}

// ---- vendor ---------------------------------------------------------------

export function vendorToDto(v: Vendor) {
  return {
    id: v.id,
    name: v.name,
    contact_email: v.contactEmail ?? null,
    payment_method: v.paymentMethod,
    payment_details: v.paymentDetails,
    is_active: v.isActive,
    created_at: v.createdAt.toISOString(),
    updated_at: v.updatedAt.toISOString(),
  };
}

// ---- bill sub-entities ---------------------------------------------------

export function lineItemToDto(li: BillLineItem) {
  return {
    id: li.id,
    bill_id: li.billId,
    description: li.description,
    amount_cents: li.amountCents,
    created_at: li.createdAt.toISOString(),
  };
}

export function attachmentToDto(a: Attachment) {
  return {
    id: a.id,
    bill_id: a.billId,
    original_filename: a.originalFilename,
    stored_filename: a.storedFilename,
    mime_type: a.mimeType,
    size_bytes: a.sizeBytes,
    uploaded_by_user_id: a.uploadedByUserId,
    uploaded_at: a.uploadedAt.toISOString(),
  };
}

export function approvalToDto(a: BillApproval) {
  return {
    id: a.id,
    bill_id: a.billId,
    rule_id: a.ruleId,
    rule_name_snapshot: a.ruleNameSnapshot,
    eligible_approver_user_ids: a.eligibleApproverUserIds,
    status: a.status,
    decided_by_user_id: a.decidedByUserId ?? null,
    decided_at: a.decidedAt ? a.decidedAt.toISOString() : null,
    rejection_reason: a.rejectionReason ?? null,
    created_at: a.createdAt.toISOString(),
  };
}

export function eventToDto(e: BillEvent) {
  return {
    id: e.id,
    bill_id: e.billId,
    event_type: e.eventType,
    actor_user_id: e.actorUserId,
    occurred_at: e.occurredAt.toISOString(),
    payload: e.payload,
  };
}

export function paymentToDto(p: Payment) {
  return {
    id: p.id,
    bill_id: p.billId,
    amount_cents: p.amountCents,
    payment_method: p.paymentMethod,
    payment_details_snapshot: p.paymentDetailsSnapshot,
    status: p.status,
    mock_reference: p.mockReference,
    initiated_by_user_id: p.initiatedByUserId,
    initiated_at: p.initiatedAt.toISOString(),
  };
}

// ---- approval rule --------------------------------------------------------

export function ruleToDto(
  rule: ApprovalRule,
  users: readonly User[],
) {
  const byId = new Map(users.map((u) => [u.id, u] as const));
  const qualified_approvers = rule.approverUserIds.map((uid) => {
    const u = byId.get(uid);
    return {
      user_id: uid,
      user_name: u?.name ?? uid,
      qualifies_at_threshold:
        !!u && u.isActive && u.maxApprovalAmountCents >= rule.minAmountCents,
    };
  });
  return {
    id: rule.id,
    name: rule.name,
    min_amount_cents: rule.minAmountCents,
    approver_user_ids: rule.approverUserIds,
    is_active: rule.isActive,
    created_at: rule.createdAt.toISOString(),
    updated_at: rule.updatedAt.toISOString(),
    qualified_approvers,
  };
}

// ---- bill summaries and detail -------------------------------------------

// The caller assembles these from Prisma `include` results; we expect the
// join fields to be present where noted. `approvals[].eligibleApproverUserIds`
// is optional on the type — callers that want `pending_approver_names` in the
// output must include it in their Prisma select AND pass `userNameById`.
export interface BillForSummary extends Bill {
  vendor: Pick<Vendor, "name">;
  creator: Pick<User, "name">;
  approvals?: (Pick<BillApproval, "status"> & {
    eligibleApproverUserIds?: string[];
  })[];
  attachment?: { id: string } | null;
}

export function billSummaryToDto(b: BillForSummary) {
  const pending_approval_count = b.approvals
    ? b.approvals.filter((a) => a.status === "pending").length
    : 0;
  return {
    id: b.id,
    vendor_id: b.vendorId,
    vendor_name: b.vendor.name,
    invoice_number: b.invoiceNumber,
    amount_cents: b.amountCents,
    status: b.status,
    due_date: toDateString(b.dueDate),
    issue_date: toDateString(b.issueDate),
    created_by_user_id: b.createdByUserId,
    created_by_user_name: b.creator.name,
    submitted_at: b.submittedAt ? b.submittedAt.toISOString() : null,
    pending_approval_count,
    has_attachment: !!b.attachment,
  };
}

// §6.6.4 — Bills list shows a "Pending approvers" column with the deduplicated
// union of pending approvals' eligible approver names. Callers that need this
// field (currently only GET /bills) must `include` approvals with
// `eligibleApproverUserIds` selected AND pass a user-name map. Other callers
// (dashboard tables) have no such column and keep using `billSummaryToDto`.
export function billSummaryToDtoWithPendingApprovers(
  b: BillForSummary,
  userNameById: ReadonlyMap<string, string>,
) {
  const base = billSummaryToDto(b);
  const pendingApprovals = b.approvals
    ? b.approvals.filter((a) => a.status === "pending")
    : [];
  const seen = new Set<string>();
  const pending_approver_names: string[] = [];
  for (const approval of pendingApprovals) {
    const ids = approval.eligibleApproverUserIds ?? [];
    for (const uid of ids) {
      if (seen.has(uid)) continue;
      seen.add(uid);
      const name = userNameById.get(uid);
      if (name) pending_approver_names.push(name);
    }
  }
  return { ...base, pending_approver_names };
}

export interface BillForDetail extends Bill {
  vendor: Vendor;
  creator: Pick<User, "name">;
  lineItems: BillLineItem[];
  attachment: Attachment | null;
  approvals: BillApproval[];
  events: BillEvent[];
  payment: Payment | null;
}

export function billDetailToDto(b: BillForDetail) {
  const pending_approval_count = b.approvals.filter(
    (a) => a.status === "pending",
  ).length;
  return {
    id: b.id,
    vendor_id: b.vendorId,
    vendor_name: b.vendor.name,
    invoice_number: b.invoiceNumber,
    amount_cents: b.amountCents,
    status: b.status,
    due_date: toDateString(b.dueDate),
    issue_date: toDateString(b.issueDate),
    created_by_user_id: b.createdByUserId,
    created_by_user_name: b.creator.name,
    submitted_at: b.submittedAt ? b.submittedAt.toISOString() : null,
    pending_approval_count,
    has_attachment: !!b.attachment,
    vendor: vendorToDto(b.vendor),
    line_items: b.lineItems.map(lineItemToDto),
    attachment: b.attachment ? attachmentToDto(b.attachment) : null,
    approvals: b.approvals.map(approvalToDto),
    events: [...b.events]
      .sort((a, z) => a.occurredAt.getTime() - z.occurredAt.getTime())
      .map(eventToDto),
    payment: b.payment ? paymentToDto(b.payment) : null,
    rejection_reason: b.rejectionReason ?? null,
  };
}

// Prisma include preset used everywhere a BillDetailDTO is returned.
export const billDetailInclude = {
  vendor: true,
  creator: { select: { name: true } },
  lineItems: { orderBy: { createdAt: "asc" as const } },
  attachment: true,
  approvals: { orderBy: { createdAt: "asc" as const } },
  events: { orderBy: { occurredAt: "asc" as const } },
  payment: true,
} as const;
