# Bill Pay MVP

A small-business Accounts Payable (AP) tool: manage vendors, capture bills,
route them through a configurable approval rules engine, and settle payments
through mocked ACH / check / wire / card rails. The authoritative
specification lives at [`docs/specs/bill-pay-mvp.md`](./docs/specs/bill-pay-mvp.md) —
this README summarizes the product, explains the scope boundary, and points at
the commands a reviewer needs; the spec is the source of truth for anything
that feels ambiguous.

## What this product does

Bill Pay is an AP product for small businesses (5–50 employees, single
entity). It replaces the common "spreadsheet + email thread" AP workflow with
a single system of record for vendors, bills, approvals, and payment history
(§1.1).

The MVP addresses three concrete pains:

1. **Manual AP is slow and error-prone** — bills tracked across sheets and
   inboxes miss due dates, incur late fees, and leave no audit trail.
2. **Weak spending controls** — without enforced approvals, money leaves the
   account with no documented sign-off.
3. **No forward cash-flow visibility** — teams can't see upcoming obligations
   without reconstructing them manually.

Bill Pay resolves #1 end-to-end (draft → submit → approve → pay, all in one
tool), enforces #2 with a configurable amount-threshold approval rules engine
(§6.4), and surfaces #3 on a payables dashboard with overdue and next-7-days
tables (§6.6.3).

## Prioritized workflows

The six core workflows from §1.2 — all implemented end-to-end. The §4.3
scripted walkthrough stitches them into a 14-step demo path.

1. **Vendor management** — create / edit / list / view vendors with payment
   details segmented by method (ACH → routing + account, check → mailing
   address, wire → SWIFT + IBAN, card → brand + last 4). Vendors with any
   bill cannot be deleted (409) — deactivate instead.
2. **Bill intake** — draft a bill against a vendor with amount, dates, line
   items, and an optional PDF attachment. Line-item amounts must sum to the
   bill total; submit is one click from draft.
3. **Approval rules engine** — create, edit, and preview amount-threshold
   rules. The editor's live preview (`POST /approval-rules/preview`,
   debounced 200ms) shows who qualifies at the threshold, who's below limit,
   and the always-eligible admin union.
4. **Bill approval** — at submission the engine snapshots each matching
   rule's eligible approver pool onto `BillApproval` rows; one click from an
   approver decides every slot they're eligible for in a single transaction
   (§6.4.5). Rejections are terminal but cloneable back to draft.
5. **Mock payment execution** — approved bills are paid in one click; the
   system snapshots the vendor's payment details, generates a mock rail
   reference, and transitions the bill to `paid`. The `Idempotency-Key`
   header makes repeat calls safe (§6.5.4).
6. **Payables dashboard** — status totals, overdue list, next-7-days
   upcoming list, and paid-last-30-days tile. All tables row-click straight
   into bill detail.

## What we left out (and why)

Per §3.2 the scope is deliberately narrow. Every cut below is intentional and
prioritized against the 4-hour challenge budget.

- **AI / OCR** — AI-powered invoice OCR, auto-coding, and "smart" approval
  recommendations. Cut because real OCR is hard and mocked OCR is window
  dressing with zero engineering signal.
- **Multi-layer approval graphs** — "require all" / "require any" /
  sequential chains. Cut because per-user limits + amount thresholds already
  exercise the complex-workflow evaluation signal without the approval-graph
  state machine cost.
- **ERP / accounting integration** — QuickBooks, NetSuite, GL coding,
  purchase-order matching. Cut because they're integration-heavy with no
  standalone product value and force modeling a chart of accounts.
- **Vendor contracts & multi-entity / multi-currency** — out of scope for a
  single-entity, USD-only SMB MVP (§6.2, §2.2).
- **Bulk actions** — select-N-and-approve. The single-bill action
  demonstrates the flow clearly; bulk UX is polish.
- **Mobile app** — desktop web only. Usable at 1280×800 minimum (§4.4 Q-10).
- **Notifications** — no email, Slack, or SMTP on any event. The in-app
  audit log + approver queue cover "who did what when".
- **Reporting / 1099** — no CSV export, no reports, no tax workflows.
- **Virtual card issuance** — `card` is a selectable payment method (mocked
  status), but there is no card-issuance flow.

Behavioral boundaries (§4.6) extend these choices at runtime: payments never
move money, rule edits never re-evaluate in-flight bills, vendor deletes
never cascade, there is no login / session / multi-tenancy.

## Setup

Primary path, reviewer side (§4.5 O-1):

```bash
cp .env.example .env   # defaults work as-is
make up                # == docker compose up --build
```

Then open:

- Web:    http://localhost:3000
- API:    http://localhost:4000
- Health: http://localhost:4000/health

On first start, the `api` container waits for Postgres, runs
`prisma migrate deploy`, and — if `SEED_ON_EMPTY=true` and the DB is empty —
seeds demo data. Subsequent `make up` runs preserve your data.

**Prerequisites**

- Docker + Docker Compose, with host ports `3000`, `4000`, `5432` free
  (override via `.env` — see below).
- Or, for non-Docker development: Node 20, pnpm 9 (via corepack), and a
  local Postgres 16 reachable via `DATABASE_URL`, then `pnpm install && pnpm dev`.

**Port overrides** (useful when the defaults collide with other dev services):

```bash
API_PORT=4001 WEB_PORT=3001 make up
```

**Useful Makefile targets** (§6.1.4):

| Target | Effect |
|---|---|
| `make up`    | `docker compose up --build` |
| `make down`  | `docker compose down` |
| `make reset` | wipes DB + uploads volumes, rebuilds, reseeds |
| `make seed`  | runs `pnpm db:seed` inside the api container |
| `make logs`  | tails compose logs |

**Environment variables** (all documented in `.env.example`): `DATABASE_URL`,
`API_PORT`, `WEB_PORT`, `UPLOAD_DIR`, `VITE_API_URL`, `SEED_ON_EMPTY`.

**Seed contents** (`packages/api/prisma/seed.ts`): 4 users, 2 approval rules,
9 vendors, 20 bills, 3 attachments — enough to demo every §4.3 step without
creating data first. See §6.8 for the seed strategy.

## Demo users (seeded)

Switch users via the top-right **user switcher** in the header. There is no
login; the selected user ID is sent as an `X-User-Id` header on every API
call (§6.1.6 — local only; any deployed build would remove it).

| Name | Role | Approval limit |
|---|---|---|
| Alice Submitter   | `submitter` | $0 |
| Bob Approver-L1   | `approver`  | $10,000 |
| Carol Approver-L2 | `approver`  | $100,000 |
| Dana Admin        | `admin`     | $0 (override applies) |

Each user exercises a different authorization path: Alice can draft and
submit but not approve; Bob clears small bills but is blocked above $10k;
Carol clears large bills; Dana (admin) can approve and pay anything
regardless of limit or rule membership (§6.3.4.1).

## Architecture & data model

**Monorepo** (§6.1.2) — pnpm workspaces, three packages under
[`packages/`](./packages): [`shared`](./packages/shared) (zod schemas +
enums + DTO types, imported by both api and web), [`api`](./packages/api)
(Express 4 + Prisma 5; routes in `src/routes/`, domain logic in
`src/services/`), and [`web`](./packages/web) (Vite 5 + React 18 + Tailwind +
shadcn/ui; screens in `src/pages/`). Stack locked by §6.1.1: Node 20,
TypeScript 5, Postgres 16, TanStack Query 5, react-hook-form, zod,
date-fns — no new runtime deps beyond that list.

**Key design decisions** (§3.3):

- **Integer cents** for every money field — no floating-point currency bugs.
- **Bill lifecycle is an API-enforced state machine** (§6.3). Illegal
  transitions return 409 Conflict as RFC 7807 problem documents; the
  frontend cannot put the backend into an inconsistent state.
- **Approval rules evaluate synchronously at T4 submission** (§6.4.2).
  No queues, no background jobs. Each matching rule produces one
  `BillApproval` with `eligible_approver_user_ids` frozen at submission.
- **Snapshots preserve audit trail** — `BillApproval.rule_name_snapshot`
  and `Payment.payment_details_snapshot` freeze values at decision time so
  later rule renames / vendor edits never rewrite history.
- **RFC 7807 error envelopes** with stable `code` values
  (`DEFAULT_RULE_REQUIRED`, `NOT_ELIGIBLE_APPROVER`, `INVALID_TRANSITION`, …)
  the UI maps to toasts and inline errors.
- **Local-only `X-User-Id` header auth** (§6.1.6) — no login, no JWT.

**Data model** — nine entities (§6.2.1): `User`, `Vendor`, `Bill`,
`BillLineItem`, `Attachment`, `ApprovalRule`, `BillApproval`, `Payment`,
`BillEvent`. Full ERD, enum catalog, the `payment_details` discriminated
union, and the deletion / referential-integrity matrix are in §6.2.

**Approval engine highlights** (§6.4): every active rule with
`min_amount_cents <= bill.amount_cents` matches and all matches must be
satisfied; regular approvers must have `max_approval_amount_cents >=
bill.amount_cents`; active admins are unioned into every snapshot
unconditionally (§6.3.4.1 override); the **default-rule invariant (V6)**
rejects any mutation that would leave zero active `min_amount_cents = 0`
rules; rule edits never re-evaluate in-flight bills (§4.6) — snapshots
are immutable.

### Demo walkthrough

The §4.3 scripted walkthrough exercises every capability in §4.2 and
doubles as the acceptance test for a reviewer:

1. `docker compose up`, open http://localhost:3000.
2. Land on dashboard — see non-zero status tiles and a pre-seeded overdue bill.
3. As **Alice**: create a new ACH vendor (form fields segment by method).
4. As Alice: create a small bill (`$1,200`), attach a PDF, submit.
5. Open the bill — rule evaluation shows required approvers.
6. Switch to **Bob** — approve. Bill moves to `approved`.
7. Pay the bill (ACH). Bill moves to `paid`; audit log records the event.
8. As Alice: create a large bill (`$15,000`), submit.
9. Both matching rules show eligible approvers (Bob filtered out by limit).
10. Switch to Bob — "Approve" disabled with "limit $10,000, bill is $15,000".
11. Switch to **Carol** — one click approves both rule slots atomically.
12. Rejection path: Alice submits, Bob rejects with a reason → `rejected`.
13. Edit an approval rule's threshold — live preview updates the eligible set.
14. Back on the dashboard — overdue list reflects the pre-seeded bill.

Optional step 15 (§4.3) — admin override: submit a $50k bill as Alice,
switch to **Dana**, approve (even though Dana is not in either rule's
approver list and has limit $0). Audit log badges show "Admin override".

For the full spec — every endpoint contract, every state transition, every
validation rule — see [`docs/specs/bill-pay-mvp.md`](./docs/specs/bill-pay-mvp.md).
