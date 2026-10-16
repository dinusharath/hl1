import { Prisma, type IngestedForm } from "@prisma/client";
import { prisma } from "../db/prisma";

/**
 * Atomically claim a batch of forms for processing.
 *
 * `FOR UPDATE SKIP LOCKED` lets many workers pull disjoint batches without blocking each other —
 * no form is ever claimed twice. A row is claimable when it is PENDING, or PROCESSING but past
 * its lease (its worker died).
 *
 * `attempts` has a single source of truth: it is bumped exactly once here, per claim. The failure
 * handler reads it but never bumps it. Before claiming we dead-letter anything that has already
 * hit the cap — including a form that keeps hard-crashing its worker and is only ever recovered by
 * the lease — so a crash loop ends in NEEDS_REVIEW instead of running forever.
 */
export async function claimForms(batchSize: number, leaseMs: number, maxAttempts: number): Promise<IngestedForm[]> {
  const leaseCutoff = new Date(Date.now() - leaseMs);

  // N14: cap enforced at claim time. Reclaimable rows that already exhausted their attempts
  // (the failure handler never got to run — e.g. the process was killed) are dead-lettered.
  await prisma.$executeRaw(Prisma.sql`
    UPDATE ingested_forms SET
      status = 'NEEDS_REVIEW'::"FormStatus",
      last_error = 'exhausted: max processing attempts',
      updated_at = now()
    WHERE next_attempt_at <= now()
      AND attempts >= ${maxAttempts}
      AND (status = 'PENDING'::"FormStatus"
           OR (status = 'PROCESSING'::"FormStatus" AND claimed_at < ${leaseCutoff}))
  `);

  const claimed = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    UPDATE ingested_forms SET
      status = 'PROCESSING'::"FormStatus",
      claimed_at = now(),
      attempts = attempts + 1,
      updated_at = now()
    WHERE id IN (
      SELECT id FROM ingested_forms
      WHERE next_attempt_at <= now()
        AND attempts < ${maxAttempts}
        AND (status = 'PENDING'::"FormStatus"
             OR (status = 'PROCESSING'::"FormStatus" AND claimed_at < ${leaseCutoff}))
      ORDER BY received_at
      FOR UPDATE SKIP LOCKED
      LIMIT ${batchSize}
    )
    RETURNING id
  `);

  if (claimed.length === 0) return [];

  const ids = claimed.map((r) => r.id);
  return prisma.ingestedForm.findMany({ where: { id: { in: ids } } });
}
