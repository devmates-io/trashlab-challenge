# Services

The business-logic services live here. Downstream engineers implement them in
Phase 2+; Phase 1 leaves the directory empty.

- `bill-state.ts` — §6.3 state-machine guards and transition executors (T1–T10).
- `approval-engine.ts` — §6.4 rule matching, eligible-pool computation,
  decision resolution.
- `payment-engine.ts` — §6.7 mock payment execution, mock reference
  generation, settlement date, idempotency (uses `src/lib/idempotency.ts`).
- `audit-log.ts` — writes `BillEvent` rows per §6.3.7.

Services consume the singleton `PrismaClient` exported from `src/db.ts` and
throw `HttpProblem` (from `src/lib/problem.ts`) for all error paths so the
RFC 7807 envelope is uniform.
