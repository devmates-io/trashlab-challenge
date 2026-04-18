// §6.3.7 — BillEvent audit log helper.
//
// Every bill state transition emits one or more events (see the matrix in
// §6.3.7). Payload shapes are per §6.2.3; admin_override is added to the
// payload when the actor used admin override (§6.3.4.1).
//
// We take a Prisma transactional client so every event insert participates
// in the same transaction as the state change that produced it.

import type { Prisma, BillEventType } from "@prisma/client";

export type BillEventPayload = Record<string, unknown>;

export interface EmitBillEventInput {
  billId: string;
  eventType: BillEventType;
  actorUserId: string;
  payload?: BillEventPayload;
  occurredAt?: Date;
}

// `tx` is the client handed into a `prisma.$transaction(async (tx) => ...)`
// callback. Using `Prisma.TransactionClient` keeps the signature narrow; we
// never call methods outside the Bill/BillEvent namespace from here.
export async function emitBillEvent(
  tx: Prisma.TransactionClient,
  input: EmitBillEventInput,
) {
  return tx.billEvent.create({
    data: {
      billId: input.billId,
      eventType: input.eventType,
      actorUserId: input.actorUserId,
      occurredAt: input.occurredAt ?? new Date(),
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
    },
  });
}
