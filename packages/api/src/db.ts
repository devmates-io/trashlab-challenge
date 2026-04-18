import { PrismaClient } from "@prisma/client";

// Singleton PrismaClient. `tsx watch` reloads the module on file changes,
// which can create multiple clients — we cache on globalThis to avoid
// exhausting the connection pool in dev.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
