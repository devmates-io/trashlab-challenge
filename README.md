# Bill Pay MVP

**Bill Pay** is a full-stack Accounts Payable (AP) web application for small
businesses (5–50 employees). It replaces the common "spreadsheet + email
thread" AP workflow with a single system of record that captures vendor
payment details, routes bills through a configurable approval rules engine,
and settles payments across ACH, check, wire, and card rails — all with a
complete, tamper-proof audit trail.

> The authoritative specification lives at
> [`docs/specs/bill-pay-mvp.md`](./docs/specs/bill-pay-mvp.md). This README
> is the reviewer's quick-start guide; the spec is the source of truth for
> anything that feels ambiguous.

**Key capabilities at a glance:**
- Vendor directory with ACH / check / wire / card payment details
- Draft → submit → approve → pay bill lifecycle with enforced state machine
- Configurable amount-threshold approval rules engine with live preview
- Mock payment execution across all four rails with idempotency support
- Payables dashboard: status totals, overdue list, next-7-days upcoming
- Full audit trail on every bill event (created, submitted, approved, paid, …)

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
never cascade, and authentication is intentionally minimal — email + password
login with opaque server-side sessions (§6.9), no OAuth/SSO/MFA/password-reset.

## Getting started

### Docker (recommended)

Prerequisites: Docker + Docker Compose, with host ports `3000`, `4000`, `5432`
free (override via `.env` — see below).

```bash
# 1. Copy environment config — defaults work as-is
cp .env.example .env

# 2. Build and start all services (API, web, Postgres)
make up
```

On first start the `api` container waits for Postgres, runs
`prisma migrate deploy`, and — if `SEED_ON_EMPTY=true` and the DB is empty —
seeds demo data. Subsequent `make up` runs preserve your data.

Open:

| Service | URL |
|---|---|
| Web app | http://localhost:3000 |
| API     | http://localhost:4000 |
| Health  | http://localhost:4000/health |

**Useful Makefile targets:**

| Target | Effect |
|---|---|
| `make up`    | `docker compose up --build` |
| `make down`  | `docker compose down` |
| `make reset` | wipes DB + uploads volumes, rebuilds, reseeds |
| `make seed`  | runs `pnpm db:seed` inside the api container |
| `make logs`  | tails compose logs |

**Port overrides** (useful when defaults collide with other dev services):

```bash
API_PORT=4001 WEB_PORT=3001 make up
```

### Local development (without Docker)

Prerequisites: Node 20, pnpm 9, Postgres 16.

```bash
# 0. Enable corepack (ships with Node 20 — activates pnpm)
corepack enable

# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env and set DATABASE_URL to your local Postgres instance, e.g.:
# DATABASE_URL=postgresql://postgres:postgres@localhost:5432/billpay

# 3. Run database migrations and seed demo data
pnpm db:migrate
pnpm db:seed

# 4. Start API and web in watch mode (hot reload)
pnpm dev
```

The API starts on `http://localhost:4000` and the web app on
`http://localhost:3000` by default.

### Running checks

```bash
# Type-check all packages
pnpm typecheck

# Lint all packages
pnpm lint

# Reset the database and reseed (destructive — wipes all data)
pnpm db:reset
```

**Environment variables** (all documented in `.env.example`): `DATABASE_URL`,
`API_PORT`, `WEB_PORT`, `UPLOAD_DIR`, `VITE_API_URL`, `SEED_ON_EMPTY`.

**Seed contents** (`packages/api/prisma/seed.ts`): 4 users, 2 approval rules,
9 vendors, 20 bills, 3 attachments — enough to demo every §4.3 step without
creating data first. See §6.8 for the seed strategy.

## API examples

Every endpoint except `GET /health` and `POST /auth/login` requires
`Authorization: Bearer <token>` where the token is obtained from
`POST /auth/login` and resolves to a server-side `Session` row (§6.9). Errors
follow [RFC 7807](https://datatracker.ietf.org/doc/html/rfc7807) with a stable
`code` field.

**Log in (mint a session token)**
```bash
curl -X POST http://localhost:4000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alice@acmewidgets.demo","password":"demo1234"}'
```
```json
{
  "token": "f8785bd2…b57d",
  "expires_at": "2026-05-06T11:48:14.858Z",
  "user": { "id": "user_alice", "name": "Alice Submitter", "role": "submitter", … },
  "impersonated_user": null
}
```

For brevity the examples below assume `TOKEN=$(…)` extracted from the login
response.

**List all vendors**
```bash
curl http://localhost:4000/vendors -H "Authorization: Bearer $TOKEN"
```
```json
[
  {
    "id": "clx…",
    "name": "Acme Corp",
    "contact_email": "ap@acme.example",
    "payment_method": "ach",
    "payment_details": { "method": "ach", "routing_number": "021000021", "account_number": "123456789", "account_holder_name": "Acme Corp" },
    "is_active": true
  }
]
```

**Create a vendor (ACH)**
```bash
curl -X POST http://localhost:4000/vendors \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "name": "Riverside Supplies",
    "contact_email": "ar@riverside.example",
    "payment_method": "ach",
    "payment_details": {
      "method": "ach",
      "routing_number": "021000021",
      "account_number": "987654321",
      "account_holder_name": "Riverside Supplies LLC"
    }
  }'
```
```json
{ "id": "clx…", "name": "Riverside Supplies", "payment_method": "ach", "is_active": true, … }
```

**Create a bill (draft)**
```bash
curl -X POST http://localhost:4000/bills \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "vendor_id": "<vendor-id>",
    "invoice_number": "INV-2024-001",
    "amount_cents": 120000,
    "issue_date": "2024-05-01",
    "due_date": "2024-05-31",
    "line_items": [
      { "description": "Consulting services", "amount_cents": 120000 }
    ]
  }'
```
```json
{ "id": "clx…", "status": "draft", "amount_cents": 120000, … }
```

**Submit a bill for approval**
```bash
curl -X POST http://localhost:4000/bills/<bill-id>/submit \
  -H "Authorization: Bearer $TOKEN"
```
```json
{ "id": "clx…", "status": "pending_approval", "approvals": [ … ], … }
```

**Admin "login as another user" (impersonation)**
```bash
curl -X POST http://localhost:4000/auth/impersonate/user_alice \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```
The same session row is mutated in place; subsequent requests carry the
admin's session token but resolve `req.user` to the impersonated identity.
Stop with `POST /auth/stop-impersonating`. Audit events written during
impersonation include `impersonated_by_user_id` in their payload (§6.9.4).

**Validation error response (example)**
```json
{
  "status": 400,
  "code": "VALIDATION_ERROR",
  "title": "Invalid request body",
  "detail": "One or more fields failed validation. See field_issues.",
  "field_issues": [
    { "path": "amount_cents", "message": "Number must be greater than 0" }
  ]
}
```

**Illegal state-transition error (example)**
```json
{
  "status": 409,
  "code": "ILLEGAL_TRANSITION",
  "title": "Illegal state transition",
  "detail": "Cannot submit a bill in status 'paid'."
}
```

## Demo users (seeded)

Sign in at `/login` with any of the seeded accounts below. **All four share
the password `demo1234`** — the login screen lists them as click-to-fill
shortcuts (§6.9). Sessions are stored as opaque bearer tokens in
`localStorage` and revoked on logout / deactivation.

| Email | Role | Approval limit |
|---|---|---|
| `alice@acmewidgets.demo` | `submitter` | $0 |
| `bob@acmewidgets.demo`   | `approver`  | $10,000 |
| `carol@acmewidgets.demo` | `approver`  | $100,000 |
| `dana@acmewidgets.demo`  | `admin`     | $0 (override applies) |

Each user exercises a different authorization path: Alice can draft and
submit but not approve; Bob clears small bills but is blocked above $10k;
Carol clears large bills; Dana (admin) can approve and pay anything
regardless of limit or rule membership (§6.3.4.1).

**Admin "login as another user"** — when signed in as Dana, the header shows a
**Login as another user** dropdown that swaps the acting identity to any
non-admin, non-self, active user via `POST /auth/impersonate/:userId`. A
yellow banner stays visible until the admin clicks "Stop impersonating". Bill
events created during impersonation record both the acting user and the real
admin in `BillEvent.payload.impersonated_by_user_id` (§6.9.4).

**Admin user management** — Dana also sees a **Users** entry in the sidebar:
list, create, edit role/limit, change password, deactivate / reactivate. The
self-edit surface for non-admins is restricted to name, email, and password —
role, limit, and `is_active` cannot be self-modified (§6.9.3).

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
  that the UI maps to toasts and inline errors.
- **Email + bcrypt password auth with opaque server-side sessions** (§6.9) —
  `Authorization: Bearer <token>` on every authenticated request. Admin-only
  user CRUD; admin "login as another user" impersonation with audit-log
  attribution. No JWT, no OAuth, no MFA, no password-reset.

**Data model** — nine entities (§6.2.1): `User`, `Vendor`, `Bill`,
`BillLineItem`, `Attachment`, `ApprovalRule`, `BillApproval`, `Payment`,
`BillEvent`. Full ERD, enum catalog, the `payment_details` discriminated
union, and the deletion / referential-integrity matrix are in §6.2.

**Approval engine highlights** (§6.4): every active rule with
`min_amount_cents <= bill.amount_cents` matches, and all matches must be
satisfied; regular approvers must have `max_approval_amount_cents >=
bill.amount_cents`; active admins are unioned into every snapshot
unconditionally (§6.3.4.1 override); the **default-rule invariant (V6)**
rejects any mutation that would leave zero active `min_amount_cents = 0`
rules; rule edits never re-evaluate in-flight bills (§4.6) — snapshots
are immutable.

**Worked example** — suppose two active rules exist:

| Rule | Threshold | Approvers |
|---|---|---|
| Any purchase | `min_amount_cents = 0` | Bob ($10k limit), Carol ($100k limit) |
| Large purchase | `min_amount_cents = 1_000_000` | Carol ($100k limit) |

Alice submits a `$15,000` bill:
- Both rules match (`0 ≤ 15,000` and `10,000 ≤ 15,000`).
- Rule 1 snapshot: Carol eligible (Bob's $10k limit is below the bill amount).
- Rule 2 snapshot: Carol eligible.
- Both `BillApproval` rows must reach `approved` before the bill advances.
- Carol approves once → her click settles both slots atomically → bill → `approved`.
- Bob's "Approve" button is disabled with "Your limit is $10,000; bill is $15,000".
- Dana (admin) could also approve either slot regardless of limit or rule membership.

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
