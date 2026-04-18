# Bill Pay MVP

A small-business Accounts Payable tool. The authoritative specification lives
at [`docs/specs/bill-pay-mvp.md`](./docs/specs/bill-pay-mvp.md) — this README
summarizes the product and points at the setup commands; the spec is the
source of truth for anything that feels ambiguous.

## What this product does

Bill Pay lets a small finance team track vendors, capture invoices as bills,
run amount-threshold approvals, and settle payments via mocked ACH / check /
wire / card rails. It replaces the common "spreadsheet + email thread" AP
workflow with a single system of record, an auditable event log, and a
forward-looking cash-flow dashboard.

## Prioritized workflows

1. **Bill → approval → payment**: a submitter drafts a bill, the approval
   rules engine snapshots required approvers at submission, an approver
   one-clicks approve, and a user with payment authority marks it paid.
2. **Dashboard at a glance**: pending approvals, awaiting payment, overdue,
   and paid-in-the-last-30-days all visible without drilling in.
3. **Vendor + rule management**: add/edit vendors with rail-specific payment
   details; configure amount-threshold approval rules with explicit
   approver lists.

## What we left out (and why)

Per §3.2 of the spec, the following were intentionally cut from scope even
though the reference product (Ramp Bill Pay) supports them: OCR / AI
auto-coding (mocking it adds no engineering signal), multi-layer approval
graphs (per-user limits already exercise the complex-workflow signal), ERP
sync, GL coding, PO matching, multi-entity, multi-currency, bulk actions,
mobile app, notifications, and reporting / 1099. See §3.2 for the full
rationale table.

## Setup

Prereqs on the reviewer machine (OQ-1 in §2.1): Docker, Docker Compose, and
free ports 3000 / 4000 / 5432 on the host. Override ports via `.env` if
needed (see `.env.example`).

```bash
cp .env.example .env
make up           # == docker compose up --build
```

On first start the api container runs Prisma migrations then seeds the DB
(guarded by `SEED_ON_EMPTY=true` — on subsequent starts your data is
preserved). Once the logs settle:

- Web:    http://localhost:3000
- Api:    http://localhost:4000
- Health: http://localhost:4000/health

Useful make targets (§6.1.4): `make up`, `make down`, `make reset` (wipes
volumes), `make seed`, `make logs`.

## Architecture & data model

Three services, one compose file: Postgres 16 · Express 4 (Prisma 5) · Vite
+ React 18 (Tailwind + shadcn/ui). TypeScript across the board; zod schemas
live in `packages/shared` and are imported by both api (for request
validation) and web (for form validation). The full data model — nine
entities, six enums, the vendor `payment_details` discriminated union, and
the deletion / referential-integrity matrix — is in §6.2 of the spec.
