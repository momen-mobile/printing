import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  pgPool?: Pool;
};

const isCloudflareWorker =
  typeof (globalThis as Record<string, unknown>).WebSocketPair !== "undefined" ||
  (typeof navigator !== "undefined" &&
    navigator.userAgent?.includes("Cloudflare-Workers"));

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    return new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }

  // On Cloudflare Workers, I/O objects (TCP sockets) cannot be shared across requests.
  // Creating a lightweight Pool (max: 1) per client/request avoids cross-request I/O errors.
  const pool = isCloudflareWorker
    ? new Pool({
        connectionString,
        max: 1,
      })
    : (globalForPrisma.pgPool ??
        new Pool({
          connectionString,
          max: 5,
        }));

  if (!isCloudflareWorker && process.env.NODE_ENV !== "production") {
    globalForPrisma.pgPool = pool;
  }

  const adapter = new PrismaPg(pool);
  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });
}

export const prisma = isCloudflareWorker
  ? createPrismaClient()
  : (globalForPrisma.prisma ?? createPrismaClient());

if (!isCloudflareWorker && process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
