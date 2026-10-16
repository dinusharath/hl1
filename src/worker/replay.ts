import { prisma } from "../db/prisma";

/**
 * Re-drive a dead-lettered form. A form parked in NEEDS_REVIEW (data problem) or FAILED (our bug,
 * now fixed) is reset to PENDING so the worker reprocesses it — safe because every pipeline step
 * is idempotent. Guarded so we only ever replay a terminal/parked form.
 */
export async function replayForm(id: string): Promise<boolean> {
  const res = await prisma.ingestedForm.updateMany({
    where: { id, status: { in: ["NEEDS_REVIEW", "FAILED"] } },
    data: { status: "PENDING", attempts: 0, lastError: null, nextAttemptAt: new Date() },
  });
  return res.count === 1;
}

/** Bulk re-drive every form in a given parked status (defaults to NEEDS_REVIEW). Returns the count. */
export async function replayAll(status: "NEEDS_REVIEW" | "FAILED" = "NEEDS_REVIEW"): Promise<number> {
  const res = await prisma.ingestedForm.updateMany({
    where: { status },
    data: { status: "PENDING", attempts: 0, lastError: null, nextAttemptAt: new Date() },
  });
  return res.count;
}
