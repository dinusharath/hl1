import type { Request, Response } from "express";
import { prisma } from "../db/prisma";

/** Liveness — the process is up. */
export function healthHandler(_req: Request, res: Response): void {
  res.json({ status: "ok" });
}

/** Readiness — we can actually reach the database. */
export async function readyHandler(_req: Request, res: Response): Promise<void> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ status: "ready" });
  } catch {
    res.status(503).json({ status: "not-ready" });
  }
}
