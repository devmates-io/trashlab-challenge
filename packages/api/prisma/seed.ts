// Minimal Phase-1 seed: the 4 users from §6.8.2.
// Full seed (rules, vendors, bills, attachments) is produced in a later phase
// by downstream engineers — see §6.8.3–§6.8.7.

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  // Guard: only seed when DB is empty (§6.8.1 "idempotent-by-emptiness").
  const seedOnEmpty = (process.env.SEED_ON_EMPTY ?? "true") === "true";
  if (!seedOnEmpty) {
    console.log("SEED_ON_EMPTY=false; skipping seed.");
    return;
  }
  const existingUserCount = await prisma.user.count();
  if (existingUserCount > 0) {
    console.log(
      `Users table already has ${existingUserCount} rows; skipping seed.`,
    );
    return;
  }

  // §6.8.2 — deterministic IDs so §4.3 / §6.4.8 walkthroughs are reproducible.
  const users = [
    {
      id: "user_alice",
      name: "Alice Submitter",
      email: "alice@acmewidgets.demo",
      role: "submitter" as const,
      maxApprovalAmountCents: 0,
      isActive: true,
    },
    {
      id: "user_bob",
      name: "Bob Approver-L1",
      email: "bob@acmewidgets.demo",
      role: "approver" as const,
      maxApprovalAmountCents: 1_000_000,
      isActive: true,
    },
    {
      id: "user_carol",
      name: "Carol Approver-L2",
      email: "carol@acmewidgets.demo",
      role: "approver" as const,
      maxApprovalAmountCents: 10_000_000,
      isActive: true,
    },
    {
      id: "user_dana",
      name: "Dana Admin",
      email: "dana@acmewidgets.demo",
      role: "admin" as const,
      maxApprovalAmountCents: 0,
      isActive: true,
    },
  ];

  for (const u of users) {
    await prisma.user.create({ data: u });
  }

  console.log(`Seeded ${users.length} users.`);
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
