import { PrismaClient } from "@prisma/client";

/**
 * Single shared PrismaClient for the process. Reused across requests and the worker loop so we
 * don't exhaust the connection pool. In dev (ts-node-dev respawns) we stash it on globalThis to
 * avoid leaking a new client on every hot reload.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ log: ["warn", "error"] });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
