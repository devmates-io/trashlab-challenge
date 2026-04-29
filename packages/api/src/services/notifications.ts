// §6.10.4 — in-app notifications.
//
// Each helper here corresponds to one bill state transition and is invoked
// from the relevant point in services/bill-state.ts or services/approval-
// engine.ts (after the corresponding BillEvent has been emitted, so the
// audit log and the notification payload stay in lock-step).
//
// Recipients are computed per-event:
//   • bill_submitted → union of the eligible approvers across all the
//     bill's pending BillApproval rows, MINUS the submitter themselves
//     (no point notifying yourself about your own submission)
//   • bill_approved  → the bill creator
//   • bill_rejected  → the bill creator
//   • bill_paid      → the bill creator
//
// We accept a `tx` (Prisma transaction client) for the same reason the
// audit log does: notifications must be created in the same transaction
// as the state mutation that produced them, so a rollback drops both the
// state change and the notification atomically.

import type { Prisma } from "@prisma/client";

interface BillRef {
  id: string;
  createdByUserId: string;
}

// Internal helper. createMany is faster than N inserts when we have many
// approvers, and skipDuplicates is harmless here (we don't insert
// duplicates by construction; it's just defence-in-depth).
async function createMany(
  tx: Prisma.TransactionClient,
  rows: Prisma.NotificationCreateManyInput[],
) {
  if (rows.length === 0) return;
  await tx.notification.createMany({ data: rows, skipDuplicates: true });
}

// bill_submitted — fire to every eligible approver across pending slots,
// minus the submitter. We accept the actor id rather than re-deriving it
// from `bill.createdByUserId` because, for a bill that's been submitted
// post-clone, `createdByUserId` and the current submitter happen to be
// the same user — but in principle a future T-X could have a different
// submitter than creator, and the audit-log conventions already pass
// `actor` everywhere.
export async function notifyBillSubmitted(
  tx: Prisma.TransactionClient,
  bill: BillRef,
  actorUserId: string,
): Promise<void> {
  const approvals = await tx.billApproval.findMany({
    where: { billId: bill.id, status: "pending" },
    select: { eligibleApproverUserIds: true },
  });
  const recipients = new Set<string>();
  for (const a of approvals) {
    for (const uid of a.eligibleApproverUserIds) {
      if (uid !== actorUserId) recipients.add(uid);
    }
  }
  await createMany(
    tx,
    Array.from(recipients).map((recipientId) => ({
      recipientId,
      type: "bill_submitted",
      billId: bill.id,
      payload: { actor_user_id: actorUserId },
    })),
  );
}

// bill_approved — notify the creator. Triggered by approval-engine.ts T6
// only (when the bill itself reaches `approved` state, not on every
// per-slot approval).
export async function notifyBillApproved(
  tx: Prisma.TransactionClient,
  bill: BillRef,
): Promise<void> {
  await createMany(tx, [
    {
      recipientId: bill.createdByUserId,
      type: "bill_approved",
      billId: bill.id,
      payload: {},
    },
  ]);
}

// bill_rejected — notify the creator with the rejection reason inline so
// the notification dropdown can show it without a second fetch.
export async function notifyBillRejected(
  tx: Prisma.TransactionClient,
  bill: BillRef,
  reason: string | null,
): Promise<void> {
  await createMany(tx, [
    {
      recipientId: bill.createdByUserId,
      type: "bill_rejected",
      billId: bill.id,
      payload: { rejection_reason: reason ?? null },
    },
  ]);
}

// bill_paid — notify the creator that the bill has settled.
export async function notifyBillPaid(
  tx: Prisma.TransactionClient,
  bill: BillRef,
  paymentMethod: string,
): Promise<void> {
  await createMany(tx, [
    {
      recipientId: bill.createdByUserId,
      type: "bill_paid",
      billId: bill.id,
      payload: { payment_method: paymentMethod },
    },
  ]);
}
