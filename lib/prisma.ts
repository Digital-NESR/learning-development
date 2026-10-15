import { PrismaClient } from "@prisma/client";
import { databaseUrl } from "@/lib/db-url.js";

// Don't fail at import time (e.g. during `next build` without DB settings); queries will report the error instead.
function safeUrl() {
  try { return databaseUrl(); } catch { return undefined; }
}

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma = globalForPrisma.prisma ?? new PrismaClient({ datasourceUrl: safeUrl() });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
