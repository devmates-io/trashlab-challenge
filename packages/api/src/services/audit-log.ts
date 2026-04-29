// §6.3.7 — BillEvent audit log helper.
//
// Every bill state transition emits one or more events (see the matrix in
// §6.3.7). Payload shapes are per §6.2.3; admin_override is added to the
// payload when the actor used admin override (§6.3.4.1). When the request
// is being made through an admin "login as" impersonation session, an
// additional `impersonated_by_user_id` field is injected into the payload
// so the audit trail records WHO was actually driving the keyboard. The
// two flags are orthogonal — both can appear together (an admin
// impersonating a non-admin and using admin override is contradictory and
// shouldn't happen, but if it does, the payload tells the full story).
//
// We take a Prisma transactional client so every event insert participates
// in the same transaction as the state change that produced it.

import type { Prisma, BillEventType, User } from "@prisma/client";

export type BillEventPayload = Record<string, unknown>;

export interface EmitBillEventInput {
  billId: string;
  eventType: BillEventType;
  // The "acting" identity stored on `BillEvent.actor_user_id`. When an admin
  // is impersonating, this is the IMPERSONATED user — the approval-engine
  // and authorization rules already treat the impersonated identity as the
  // acting user, and the audit trail follows the same convention.
  actor: User;
  // The real authenticated session owner. When `realUser.id !==
  // actor.id` (i.e., an impersonation session), `impersonated_by_user_id:
  // realUser.id` is merged into the payload. Optional; defaults to `actor`,
  // which is the right answer for non-impersonation callers (seed script,
  // future server-internal callers).
  realUser?: User;
  payload?: BillEventPayload;
  occurredAt?: Date;
}

// Returns the payload to persist, with `impersonated_by_user_id` injected
// when the real session owner differs from the acting identity. Existing
// payload fields are preserved verbatim — callers that already set
// `admin_override: true` continue to do so independently.
function withImpersonationFlag(
  payload: BillEventPayload,
  actor: Pick<User, "id">,
  realUser: Pick<User, "id"> | undefined,
): BillEventPayload {
  if (!realUser || realUser.id === actor.id) return payload;
  return { ...payload, impersonated_by_user_id: realUser.id };
}

// `tx` is the client handed into a `prisma.$transaction(async (tx) => ...)`
// callback. Using `Prisma.TransactionClient` keeps the signature narrow; we
// never call methods outside the Bill/BillEvent namespace from here.
export async function emitBillEvent(
  tx: Prisma.TransactionClient,
  input: EmitBillEventInput,
) {
  const finalPayload = withImpersonationFlag(
    input.payload ?? {},
    input.actor,
    input.realUser,
  );
  return tx.billEvent.create({
    data: {
      billId: input.billId,
      eventType: input.eventType,
      actorUserId: input.actor.id,
      occurredAt: input.occurredAt ?? new Date(),
      payload: finalPayload as Prisma.InputJsonValue,
    },
  });
}
