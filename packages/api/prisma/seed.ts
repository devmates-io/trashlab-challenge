// Full demo seed per §6.8.
//
// Runs at api-container startup when SEED_ON_EMPTY=true AND the users table
// is empty (§6.8.1 "idempotent-by-emptiness"). Every bill is driven through
// the real state-machine services (§6.8.7) so the resulting BillEvent /
// BillApproval / Payment rows are genuine outputs of the approval engine —
// not raw Prisma inserts. After each transition sequence, we backdate the
// associated timestamps to the relative offsets specified in §6.8.5
// (otherwise every bill would appear "just now", which breaks the
// dashboard's overdue / upcoming / last-30-days widgets; §9.2 T-R6).

import { PrismaClient, type User } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { addDays, subDays } from "date-fns";
import { copyFileSync, mkdirSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  approveBillT5T6,
  createBill,
  payBill,
  rejectApproval,
  submitBill,
} from "../src/services/bill-state.js";
import { backdateBill, type BillTimestamps } from "../src/lib/seed-helpers.js";

const prisma = new PrismaClient();

const __dirname = dirname(fileURLToPath(import.meta.url));
const SEED_ASSETS_DIR = resolve(__dirname, "seed-assets");
const SAMPLE_INVOICE_PATH = resolve(SEED_ASSETS_DIR, "sample-invoice.pdf");
const UPLOAD_DIR = process.env.UPLOAD_DIR ?? "/app/uploads";

// ---- helpers ----------------------------------------------------------------

function toDateStr(d: Date): string {
  const y = d.getUTCFullYear().toString().padStart(4, "0");
  const m = (d.getUTCMonth() + 1).toString().padStart(2, "0");
  const day = d.getUTCDate().toString().padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// All bill specs use this shape; the runner below walks the list and invokes
// the right service calls for each `status`.
type PaymentDetails = Prisma.InputJsonValue;

interface VendorSpec {
  key: string;
  name: string;
  contact_email: string | null;
  payment_method: "ach" | "check" | "wire" | "card";
  payment_details: PaymentDetails;
}

interface BillSpec {
  invoice_number: string;
  vendor_key: string;
  amount_cents: number;
  line_items: Array<{ description: string; amount_cents: number }>;
  issue_days_ago: number;
  due_days_out: number;
  // Lifecycle: where to stop.
  status: "draft" | "pending_approval" | "approved" | "rejected" | "paid";
  // Offsets from now() in days (positive = in the past).
  created_days_ago: number;
  submitted_days_ago?: number;
  decided_days_ago?: number;
  paid_days_ago?: number;
  // Actor IDs (fixed user IDs from §6.8.2).
  approver_user_id?: string;
  rejecter_user_id?: string;
  // Which rule's approval to reject (if multiple matching).
  reject_rule_id?: string;
  payer_user_id?: string;
  rejection_reason?: string;
  // If set, attach the sample PDF.
  has_attachment?: boolean;
}

// ---- main -------------------------------------------------------------------

async function main() {
  // §6.8.1 — idempotent-by-emptiness. If the users table is non-empty we are
  // a no-op on startup; the reviewer's mutations persist across container
  // restarts (only `make reset` with `-v` wipes state).
  const seedOnEmpty = (process.env.SEED_ON_EMPTY ?? "true") === "true";
  if (!seedOnEmpty) {
    console.log("[seed] SEED_ON_EMPTY=false; skipping.");
    return;
  }
  const existingUserCount = await prisma.user.count();
  if (existingUserCount > 0) {
    console.log("[seed] DB not empty; skipping seed.");
    return;
  }

  const now = new Date();

  // -------------------------------------------------------------------------
  // §6.8.2 — Users. Deterministic IDs so the §4.3 / §6.4.8 walkthroughs
  // reference the same rows across restarts.
  // -------------------------------------------------------------------------
  await prisma.user.createMany({
    data: [
      {
        id: "user_alice",
        name: "Alice Submitter",
        email: "alice@acmewidgets.demo",
        role: "submitter",
        maxApprovalAmountCents: 0,
        isActive: true,
      },
      {
        id: "user_bob",
        name: "Bob Approver-L1",
        email: "bob@acmewidgets.demo",
        role: "approver",
        maxApprovalAmountCents: 1_000_000,
        isActive: true,
      },
      {
        id: "user_carol",
        name: "Carol Approver-L2",
        email: "carol@acmewidgets.demo",
        role: "approver",
        maxApprovalAmountCents: 10_000_000,
        isActive: true,
      },
      {
        id: "user_dana",
        name: "Dana Admin",
        email: "dana@acmewidgets.demo",
        role: "admin",
        maxApprovalAmountCents: 0,
        isActive: true,
      },
    ],
  });
  console.log("[seed] users: 4");

  // Services expect fully hydrated User objects (typed as @prisma/client.User).
  const [alice, bob, carol, dana] = await Promise.all([
    prisma.user.findUniqueOrThrow({ where: { id: "user_alice" } }),
    prisma.user.findUniqueOrThrow({ where: { id: "user_bob" } }),
    prisma.user.findUniqueOrThrow({ where: { id: "user_carol" } }),
    prisma.user.findUniqueOrThrow({ where: { id: "user_dana" } }),
  ]);
  const usersById: Record<string, User> = {
    user_alice: alice,
    user_bob: bob,
    user_carol: carol,
    user_dana: dana,
  };

  // -------------------------------------------------------------------------
  // §6.8.3 — Approval rules. Deterministic IDs (referenced in spec prose and
  // the §6.4.8 worked example).
  // -------------------------------------------------------------------------
  await prisma.approvalRule.createMany({
    data: [
      {
        id: "rule_default",
        name: "Default (all bills)",
        minAmountCents: 0,
        approverUserIds: ["user_bob", "user_carol"],
        isActive: true,
      },
      {
        id: "rule_high_value",
        name: "Bills ≥ $10,000",
        minAmountCents: 1_000_000,
        approverUserIds: ["user_carol"],
        isActive: true,
      },
    ],
  });

  // §6.4.4 sanity — at least one active min=0 rule must exist.
  const defaultCount = await prisma.approvalRule.count({
    where: { isActive: true, minAmountCents: 0 },
  });
  if (defaultCount < 1) {
    throw new Error("V6 invariant violated after seeding rules");
  }
  console.log("[seed] approval rules: 2");

  // -------------------------------------------------------------------------
  // §6.8.4 — Vendors. Random CUIDs. Payment-details shapes per §6.2.6.
  // Linear Cloud Inc. is seeded as a card vendor for demo coverage; reviewers
  // can also create additional card vendors through the /vendors/new UI.
  // -------------------------------------------------------------------------
  const vendorSpecs: VendorSpec[] = [
    {
      key: "sterling",
      name: "Sterling & Hayes Legal LLP",
      contact_email: "billing@sterling-hayes.example",
      payment_method: "ach",
      payment_details: {
        method: "ach",
        routing_number: "021000021",
        account_number: "1000004567",
        account_holder_name: "Sterling & Hayes Legal LLP",
      },
    },
    {
      key: "linear",
      name: "Linear Cloud Inc.",
      contact_email: "ar@linearcloud.example",
      payment_method: "card",
      payment_details: {
        method: "card",
        card_brand: "visa",
        last_four: "4242",
      },
    },
    {
      key: "coastal",
      name: "Coastal Power & Light",
      contact_email: "accounts@coastalpower.example",
      payment_method: "ach",
      payment_details: {
        method: "ach",
        routing_number: "044000037",
        account_number: "1000008891",
        account_holder_name: "Coastal Power & Light Co",
      },
    },
    {
      key: "bluefin",
      name: "Bluefin Creative Agency",
      contact_email: "billing@bluefincreative.example",
      payment_method: "ach",
      payment_details: {
        method: "ach",
        routing_number: "121000248",
        account_number: "1000003304",
        account_holder_name: "Bluefin Creative LLC",
      },
    },
    {
      key: "quill",
      name: "Quill Office Supply Co.",
      contact_email: "invoices@quillsupply.example",
      payment_method: "ach",
      payment_details: {
        method: "ach",
        routing_number: "011000015",
        account_number: "1000009012",
        account_holder_name: "Quill Office Supply Co",
      },
    },
    {
      key: "midwest",
      name: "Midwest Freight Services",
      contact_email: "ar@midwestfreight.example",
      payment_method: "wire",
      payment_details: {
        method: "wire",
        bank_name: "First Midwest Bank",
        swift_code: "FMWBUS33",
        iban: "US29NWBK60161331926819",
        account_holder_name: "Midwest Freight Services",
      },
    },
    {
      key: "brickline",
      name: "Brickline Construction",
      contact_email: "office@brickline.example",
      payment_method: "check",
      payment_details: {
        method: "check",
        address_line1: "420 Industrial Way",
        address_line2: null,
        city: "Trenton",
        state: "NJ",
        postal_code: "08611",
      },
    },
    {
      key: "turnkey",
      name: "Turnkey IT Solutions",
      contact_email: "billing@turnkeyit.example",
      payment_method: "ach",
      payment_details: {
        method: "ach",
        routing_number: "061000104",
        account_number: "1000006678",
        account_holder_name: "Turnkey IT Solutions LLC",
      },
    },
    {
      key: "precision",
      name: "Precision Tools Inc.",
      contact_email: "ap@precisiontools.example",
      payment_method: "ach",
      payment_details: {
        method: "ach",
        routing_number: "114000093",
        account_number: "1000002215",
        account_holder_name: "Precision Tools Inc",
      },
    },
  ];

  const vendorIdByKey: Record<string, string> = {};
  for (const v of vendorSpecs) {
    const row = await prisma.vendor.create({
      data: {
        name: v.name,
        contactEmail: v.contact_email,
        paymentMethod: v.payment_method,
        paymentDetails: v.payment_details,
        isActive: true,
      },
    });
    vendorIdByKey[v.key] = row.id;
  }
  console.log(`[seed] vendors: ${vendorSpecs.length}`);

  // -------------------------------------------------------------------------
  // §6.8.5 — Bills. Defined declaratively; a single runner below executes the
  // right sequence of service calls per `status` and then backdates.
  // Amounts are in integer cents — multiply by 100 (not * 100.0 which loses
  // precision on odd dollar amounts).
  // -------------------------------------------------------------------------
  const billSpecs: BillSpec[] = [
    // Drafts — created only, never submitted.
    {
      invoice_number: "INV-D-001",
      vendor_key: "linear",
      amount_cents: 48000,
      line_items: [
        { description: "Linear Cloud Pro — April subscription", amount_cents: 48000 },
      ],
      issue_days_ago: 2,
      due_days_out: 30,
      status: "draft",
      created_days_ago: 2,
    },
    {
      invoice_number: "INV-D-002",
      vendor_key: "quill",
      amount_cents: 124000,
      line_items: [
        { description: "Paper + toner", amount_cents: 89000 },
        { description: "Ergonomic chair", amount_cents: 35000 },
      ],
      issue_days_ago: 1,
      due_days_out: 15,
      status: "draft",
      created_days_ago: 1,
    },
    {
      invoice_number: "INV-D-003",
      vendor_key: "bluefin",
      amount_cents: 350000,
      line_items: [
        { description: "Website redesign — deposit", amount_cents: 350000 },
      ],
      issue_days_ago: 0,
      due_days_out: 45,
      status: "draft",
      created_days_ago: 0,
    },
    {
      invoice_number: "INV-D-004",
      vendor_key: "coastal",
      amount_cents: 89000,
      line_items: [
        { description: "Electricity — March 2026", amount_cents: 89000 },
      ],
      issue_days_ago: 3,
      due_days_out: 20,
      status: "draft",
      created_days_ago: 3,
    },

    // Pending approval — submitted by Alice, no decisions yet.
    {
      invoice_number: "INV-P-001",
      vendor_key: "sterling",
      amount_cents: 120000,
      line_items: [
        { description: "Contract review — Q2 MSA", amount_cents: 80000 },
        { description: "Vendor agreement drafting", amount_cents: 40000 },
      ],
      issue_days_ago: 2,
      due_days_out: 25,
      status: "pending_approval",
      created_days_ago: 2,
      submitted_days_ago: 2,
    },
    {
      invoice_number: "INV-P-002",
      vendor_key: "midwest",
      amount_cents: 1450000,
      line_items: [
        { description: "Freight — 3 truckloads Q1 materials", amount_cents: 1200000 },
        { description: "Fuel surcharge", amount_cents: 250000 },
      ],
      issue_days_ago: 1,
      due_days_out: 10,
      status: "pending_approval",
      created_days_ago: 1,
      submitted_days_ago: 1,
    },
    {
      invoice_number: "INV-P-003",
      vendor_key: "turnkey",
      amount_cents: 875000,
      line_items: [
        { description: "Workstation replacement — 5 units", amount_cents: 750000 },
        { description: "Onsite setup & imaging", amount_cents: 125000 },
      ],
      issue_days_ago: 0,
      due_days_out: 8,
      status: "pending_approval",
      created_days_ago: 0,
      submitted_days_ago: 0,
    },
    {
      invoice_number: "INV-P-004",
      vendor_key: "brickline",
      amount_cents: 2200000,
      line_items: [
        { description: "Warehouse expansion — foundation", amount_cents: 1500000 },
        { description: "Steel framing, labor", amount_cents: 700000 },
      ],
      issue_days_ago: 3,
      due_days_out: 60,
      status: "pending_approval",
      created_days_ago: 3,
      submitted_days_ago: 3,
    },

    // Approved — submitted, approved (not yet paid). At least one overdue
    // (INV-A-001) and one in the upcoming-7-days window (INV-A-002).
    {
      invoice_number: "INV-A-001",
      vendor_key: "precision",
      amount_cents: 640000,
      line_items: [
        { description: "CNC mill service contract — Q1", amount_cents: 500000 },
        { description: "Replacement bits & tooling", amount_cents: 140000 },
      ],
      issue_days_ago: 18,
      due_days_out: -15,
      status: "approved",
      created_days_ago: 18,
      submitted_days_ago: 18,
      decided_days_ago: 16,
      approver_user_id: "user_bob",
      has_attachment: true,
    },
    {
      invoice_number: "INV-A-002",
      vendor_key: "bluefin",
      amount_cents: 230000,
      line_items: [
        { description: "Landing page revisions — final round", amount_cents: 230000 },
      ],
      issue_days_ago: 4,
      due_days_out: 3,
      status: "approved",
      created_days_ago: 4,
      submitted_days_ago: 4,
      decided_days_ago: 0,
      approver_user_id: "user_bob",
    },
    {
      invoice_number: "INV-A-003",
      vendor_key: "quill",
      amount_cents: 187500,
      line_items: [
        { description: "Monthly office supplies — March", amount_cents: 187500 },
      ],
      issue_days_ago: 5,
      due_days_out: 20,
      status: "approved",
      created_days_ago: 5,
      submitted_days_ago: 5,
      decided_days_ago: 1,
      approver_user_id: "user_bob",
    },

    // Rejected — audit-realistic reasons.
    {
      invoice_number: "INV-R-001",
      vendor_key: "bluefin",
      amount_cents: 45000,
      line_items: [
        { description: "Retainer — design services (April)", amount_cents: 45000 },
      ],
      issue_days_ago: 4,
      due_days_out: 25,
      status: "rejected",
      created_days_ago: 4,
      submitted_days_ago: 4,
      decided_days_ago: 3,
      rejecter_user_id: "user_bob",
      reject_rule_id: "rule_default",
      rejection_reason: "Duplicate of INV-1023",
    },
    {
      invoice_number: "INV-R-002",
      vendor_key: "midwest",
      amount_cents: 1500000,
      line_items: [
        { description: "Emergency rush shipment — Chicago hub", amount_cents: 1500000 },
      ],
      issue_days_ago: 5,
      due_days_out: 30,
      status: "rejected",
      created_days_ago: 5,
      submitted_days_ago: 5,
      decided_days_ago: 4,
      rejecter_user_id: "user_carol",
      // §6.8.10: the cancelled row comes from the default rule, so the
      // high-value rule is the rejection target.
      reject_rule_id: "rule_high_value",
      rejection_reason:
        "Missing purchase order reference. Please resubmit with PO.",
    },

    // Paid — all initiated in the last 30 days for the dashboard widget.
    // For paid bills the spec gives only `paid_days_ago`; we pick a plausible
    // chain: created_at = paid_at - 4d, submitted = paid_at - 3d,
    // decided_at = paid_at - 1d.
    {
      invoice_number: "INV-PD-001",
      vendor_key: "sterling",
      amount_cents: 120000,
      line_items: [
        { description: "General counsel retainer — Feb", amount_cents: 120000 },
      ],
      issue_days_ago: 19,
      due_days_out: -13,
      status: "paid",
      created_days_ago: 19,
      submitted_days_ago: 18,
      decided_days_ago: 16,
      paid_days_ago: 15,
      approver_user_id: "user_bob",
      payer_user_id: "user_bob",
      has_attachment: true,
    },
    {
      invoice_number: "INV-PD-002",
      vendor_key: "coastal",
      amount_cents: 49500,
      line_items: [
        { description: "Electricity — February 2026", amount_cents: 49500 },
      ],
      issue_days_ago: 14,
      due_days_out: -3,
      status: "paid",
      created_days_ago: 14,
      submitted_days_ago: 13,
      decided_days_ago: 11,
      paid_days_ago: 10,
      approver_user_id: "user_bob",
      payer_user_id: "user_bob",
    },
    {
      invoice_number: "INV-PD-003",
      vendor_key: "linear",
      amount_cents: 240000,
      line_items: [
        { description: "Linear Cloud Enterprise — Q1", amount_cents: 240000 },
      ],
      issue_days_ago: 9,
      due_days_out: 6,
      status: "paid",
      created_days_ago: 9,
      submitted_days_ago: 8,
      decided_days_ago: 6,
      paid_days_ago: 5,
      approver_user_id: "user_carol",
      payer_user_id: "user_carol",
    },
    {
      invoice_number: "INV-PD-004",
      vendor_key: "quill",
      amount_cents: 78000,
      line_items: [
        { description: "Copy paper + breakroom supplies", amount_cents: 78000 },
      ],
      issue_days_ago: 29,
      due_days_out: -15,
      status: "paid",
      created_days_ago: 29,
      submitted_days_ago: 28,
      decided_days_ago: 26,
      paid_days_ago: 25,
      approver_user_id: "user_bob",
      payer_user_id: "user_bob",
    },
    {
      invoice_number: "INV-PD-005",
      vendor_key: "turnkey",
      amount_cents: 950000,
      line_items: [
        { description: "Laptop refresh — engineering team (5)", amount_cents: 900000 },
        { description: "MDM licenses — annual", amount_cents: 50000 },
      ],
      issue_days_ago: 6,
      due_days_out: 8,
      status: "paid",
      created_days_ago: 6,
      submitted_days_ago: 5,
      decided_days_ago: 3,
      paid_days_ago: 2,
      approver_user_id: "user_carol",
      payer_user_id: "user_carol",
      has_attachment: true,
    },
    {
      invoice_number: "INV-PD-006",
      vendor_key: "bluefin",
      amount_cents: 110000,
      line_items: [
        { description: "Brand guidelines deck", amount_cents: 110000 },
      ],
      issue_days_ago: 22,
      due_days_out: -10,
      status: "paid",
      created_days_ago: 22,
      submitted_days_ago: 21,
      decided_days_ago: 19,
      paid_days_ago: 18,
      approver_user_id: "user_bob",
      payer_user_id: "user_bob",
    },
    {
      invoice_number: "INV-PD-007",
      vendor_key: "brickline",
      amount_cents: 34500,
      line_items: [
        { description: "Repair — loading dock door", amount_cents: 34500 },
      ],
      issue_days_ago: 11,
      due_days_out: 4,
      status: "paid",
      created_days_ago: 11,
      submitted_days_ago: 10,
      decided_days_ago: 8,
      paid_days_ago: 7,
      approver_user_id: "user_bob",
      payer_user_id: "user_bob",
    },
  ];

  // Verify the PDF we'll attach exists. Bail loudly if not — we'd rather fail
  // the seed than silently skip attachments.
  try {
    statSync(SAMPLE_INVOICE_PATH);
  } catch {
    throw new Error(
      `Missing sample invoice PDF at ${SAMPLE_INVOICE_PATH}; add it before running the seed`,
    );
  }
  mkdirSync(UPLOAD_DIR, { recursive: true });
  const sampleSizeBytes = statSync(SAMPLE_INVOICE_PATH).size;

  let billsCreated = 0;
  let attachmentsCreated = 0;

  for (const spec of billSpecs) {
    const vendorId = vendorIdByKey[spec.vendor_key];
    if (!vendorId) throw new Error(`unknown vendor_key ${spec.vendor_key}`);

    const issueDate = toDateStr(subDays(now, spec.issue_days_ago));
    const dueDate = toDateStr(addDays(now, spec.due_days_out));

    // T1 — draft creation (alice is always the creator per §6.8.5).
    const draft = await createBill(alice, {
      vendor_id: vendorId,
      invoice_number: spec.invoice_number,
      amount_cents: spec.amount_cents,
      issue_date: issueDate,
      due_date: dueDate,
      line_items: spec.line_items,
      attachment_id: null, // attachments go in via direct insert below
    });
    const billId = draft.id;

    // Drive the bill through its lifecycle via services.
    if (spec.status !== "draft") {
      if (spec.submitted_days_ago === undefined) {
        throw new Error(
          `bill ${spec.invoice_number} needs submitted_days_ago`,
        );
      }
      await submitBill(alice, billId);

      if (spec.status === "approved" || spec.status === "paid") {
        if (!spec.approver_user_id) {
          throw new Error(
            `bill ${spec.invoice_number} needs approver_user_id`,
          );
        }
        const approver = usersById[spec.approver_user_id];
        if (!approver) throw new Error(`unknown approver ${spec.approver_user_id}`);
        await approveBillT5T6(approver, billId);
      }

      if (spec.status === "rejected") {
        if (!spec.rejecter_user_id || !spec.reject_rule_id) {
          throw new Error(
            `bill ${spec.invoice_number} needs rejecter_user_id and reject_rule_id`,
          );
        }
        const rejecter = usersById[spec.rejecter_user_id];
        if (!rejecter) {
          throw new Error(`unknown rejecter ${spec.rejecter_user_id}`);
        }
        const targetApproval = await prisma.billApproval.findFirst({
          where: { billId, ruleId: spec.reject_rule_id, status: "pending" },
        });
        if (!targetApproval) {
          throw new Error(
            `no pending approval under rule ${spec.reject_rule_id} for ${spec.invoice_number}`,
          );
        }
        await rejectApproval(
          rejecter,
          targetApproval.id,
          spec.rejection_reason ?? null,
        );
      }

      if (spec.status === "paid") {
        if (!spec.payer_user_id) {
          throw new Error(
            `bill ${spec.invoice_number} needs payer_user_id`,
          );
        }
        const payer = usersById[spec.payer_user_id];
        if (!payer) throw new Error(`unknown payer ${spec.payer_user_id}`);
        await payBill(payer, billId, null);
      }
    }

    // §6.8.7 — backdate all timestamps that the services just set to "now".
    const ts: BillTimestamps = {
      created_at: subDays(now, spec.created_days_ago),
    };
    if (spec.submitted_days_ago !== undefined) {
      ts.submitted_at = subDays(now, spec.submitted_days_ago);
    }
    if (spec.decided_days_ago !== undefined) {
      ts.decided_at = subDays(now, spec.decided_days_ago);
    }
    if (spec.paid_days_ago !== undefined) {
      ts.paid_at = subDays(now, spec.paid_days_ago);
    }
    await backdateBill(prisma, billId, ts);

    // §6.8.6 — attach the sample PDF to the three designated bills. We
    // bypass the upload-staging flow (which expects an HTTP request) and
    // insert the Attachment row directly, since we already know the bill_id
    // and the file can be copied from seed-assets at seed time.
    if (spec.has_attachment) {
      const storedFilename = `${randomBytes(12).toString("hex")}.pdf`;
      const destPath = resolve(UPLOAD_DIR, storedFilename);
      copyFileSync(SAMPLE_INVOICE_PATH, destPath);

      await prisma.attachment.create({
        data: {
          billId,
          originalFilename: "sample-invoice.pdf",
          storedFilename,
          mimeType: "application/pdf",
          sizeBytes: sampleSizeBytes,
          uploadedByUserId: "user_alice",
          uploadedAt: ts.created_at,
        },
      });
      attachmentsCreated += 1;
    }

    billsCreated += 1;
  }

  console.log(
    `[seed] Seeded 4 users, 2 rules, ${vendorSpecs.length} vendors, ${billsCreated} bills, ${attachmentsCreated} attachments.`,
  );
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
