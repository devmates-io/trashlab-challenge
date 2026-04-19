// Helpers used exclusively by the seed script (§6.8). Kept here (not under
// prisma/) so the PrismaClient singleton and app types are shared with the
// rest of the API; keeps the seed entry point thin.
//
// The main surface is `backdateBill`: after a bill has been driven through
// its state transitions via the real service functions (bill-state.ts), the
// resulting timestamps are all "just now". This helper rewrites the bill's
// `created_at`, `submitted_at`, each `BillEvent.occurred_at`, each
// `BillApproval.decided_at` / `created_at`, and the `Payment.initiated_at`
// to the relative offsets the spec prescribes in §6.8.5. Without this, the
// dashboard's "paid last 30 days" widget would show every paid bill at the
// same instant, which is unrealistic (§9.2 T-R6).

import type { PrismaClient } from "@prisma/client";

export interface BillTimestamps {
  created_at: Date;
  submitted_at?: Date;
  decided_at?: Date;
  paid_at?: Date;
}

// Update the bill row + associated audit rows to reflect the prescribed
// offsets. We use `prisma.$executeRaw` for the Bill update so Prisma's
// automatic `@updatedAt` behavior doesn't clobber our backdated `updated_at`.
// Events / approvals / payments are updated via typed `update`/`updateMany`
// because those models have no `@updatedAt`.
export async function backdateBill(
  prisma: PrismaClient,
  billId: string,
  ts: BillTimestamps,
): Promise<void> {
  const finalUpdatedAt =
    ts.paid_at ?? ts.decided_at ?? ts.submitted_at ?? ts.created_at;

  await prisma.$executeRaw`
    UPDATE bills SET
      created_at = ${ts.created_at},
      updated_at = ${finalUpdatedAt},
      submitted_at = ${ts.submitted_at ?? null}
    WHERE id = ${billId}
  `;

  // Re-assign each event's occurred_at by type. For `approved` events we
  // preserve the per-approval → bill-level ordering by adding +i ms as we
  // walk through them in the order they were originally emitted.
  const events = await prisma.billEvent.findMany({
    where: { billId },
    orderBy: { occurredAt: "asc" },
  });

  let approvedIdx = 0;
  for (const evt of events) {
    let occurredAt: Date | null = null;
    switch (evt.eventType) {
      case "created":
        occurredAt = ts.created_at;
        break;
      case "submitted":
        occurredAt = ts.submitted_at ?? null;
        break;
      case "approved":
        if (ts.decided_at) {
          occurredAt = new Date(ts.decided_at.getTime() + approvedIdx);
          approvedIdx += 1;
        }
        break;
      case "rejected":
        occurredAt = ts.decided_at ?? null;
        break;
      case "paid":
        occurredAt = ts.paid_at ?? null;
        break;
      default:
        break;
    }
    if (occurredAt) {
      await prisma.billEvent.update({
        where: { id: evt.id },
        data: { occurredAt },
      });
    }
  }

  if (ts.submitted_at) {
    await prisma.billApproval.updateMany({
      where: { billId },
      data: { createdAt: ts.submitted_at },
    });
  }
  if (ts.decided_at) {
    // Covers approved / rejected / cancelled (cascaded) rows — anything with
    // a non-null decidedAt, which the service already set to "now".
    await prisma.billApproval.updateMany({
      where: { billId, NOT: { decidedAt: null } },
      data: { decidedAt: ts.decided_at },
    });
  }
  if (ts.paid_at) {
    await prisma.payment.updateMany({
      where: { billId },
      data: { initiatedAt: ts.paid_at },
    });
  }
}
