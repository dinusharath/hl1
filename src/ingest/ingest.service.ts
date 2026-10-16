import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { hashPayload, deriveIdempotencyKey } from "../domain/forms/payload-hash";
import type { Flag } from "../domain/forms/transformed-form";

export type IngestOutcome = "accepted" | "duplicate" | "conflict";

export interface IngestResult {
  id: string;
  outcome: IngestOutcome;
  status: string;
}

interface IngestRow {
  id: string;
  inserted: boolean;
  status: string;
  payload_hash: string;
}

/**
 * Persist an incoming payload and dedupe it in a single atomic statement
 * (PLAN.md §"how do we know it's the same?").
 *
 * The idempotency key is the provider's `session_id`; if drift has dropped it we fall back to the
 * content hash and soft-flag `missing_session_id`. The key is stored in the unique `session_id`
 * column, so `ON CONFLICT` gives us the three-way verdict:
 *   - fresh insert                      → `accepted`  (status PENDING, picked up by the worker)
 *   - same key + same payload_hash      → `duplicate` (bump duplicate_count, never reprocess)
 *   - same key + different payload_hash → `conflict`  (NEEDS_REVIEW — a reused id with new data)
 *
 * The response is identical (`202`) for accepted and duplicate — that is what makes ingest
 * idempotent. We never reject a schema change here; that's the worker's review path.
 */
export async function ingestForm(payload: unknown): Promise<IngestResult> {
  const payloadHash = hashPayload(payload);
  const sessionId = extractSessionId(payload);
  const { key, usedFallback } = deriveIdempotencyKey(sessionId, payloadHash);

  const flags: Flag[] = usedFallback
    ? [{ code: "missing_session_id", detail: "no session_id on payload; deduped on content hash" }]
    : [];

  const rawJson = JSON.stringify(payload);
  const flagsJson = JSON.stringify(flags);
  const applicationReference = extractString(payload, "application_reference");

  // The main upsert and the conflict-payload insert below commit together: if we can't durably
  // record a conflicting payload, we must not report the redelivery as accepted either (we never
  // claim acceptance without durable persistence).
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<IngestRow[]>(Prisma.sql`
      INSERT INTO ingested_forms
        (id, session_id, application_reference, raw_payload, payload_hash, status, flags,
         attempts, next_attempt_at, received_at, updated_at, last_seen_at, duplicate_count)
      VALUES
        (gen_random_uuid()::text, ${key}, ${applicationReference}, ${rawJson}::jsonb, ${payloadHash},
         'PENDING', ${flagsJson}::jsonb, 0, now(), now(), now(), now(), 0)
      ON CONFLICT (session_id) DO UPDATE SET
        duplicate_count = ingested_forms.duplicate_count + 1,
        last_seen_at    = now(),
        updated_at      = now(),
        -- Only escalate to review from a NON-terminal state: a conflicting redelivery must surface,
        -- but it must not reopen a form already processed to DONE (or parked in FAILED/NEEDS_REVIEW)
        -- — that original is preserved untouched. The conflicting payload itself is never lost
        -- either way: it is durably recorded in form_conflicts below, for a human to apply by hand.
        status = CASE WHEN ingested_forms.payload_hash <> EXCLUDED.payload_hash
                       AND ingested_forms.status NOT IN
                           ('DONE'::"FormStatus",'FAILED'::"FormStatus",'NEEDS_REVIEW'::"FormStatus")
                      THEN 'NEEDS_REVIEW'::"FormStatus" ELSE ingested_forms.status END,
        last_error = CASE WHEN ingested_forms.payload_hash <> EXCLUDED.payload_hash
                          THEN 'duplicate session_id delivered with different payload — see conflicts'
                          ELSE ingested_forms.last_error END
      RETURNING id, (xmax = 0) AS inserted, status::text AS status, payload_hash
    `);

    const row = rows[0];
    const outcome: IngestOutcome = row.inserted
      ? "accepted"
      : row.payload_hash === payloadHash
        ? "duplicate"
        : "conflict";

    if (outcome === "conflict") {
      await tx.formConflict.create({
        data: { ingestedFormId: row.id, payload: payload as Prisma.InputJsonValue, payloadHash },
      });
    }

    return { id: row.id, outcome, status: row.status };
  });
}

/** Unresolved conflicts for one form — what an operator sees when deciding how to fix it by hand. */
export async function listConflicts(ingestedFormId: string) {
  return prisma.formConflict.findMany({
    where: { ingestedFormId },
    orderBy: { receivedAt: "desc" },
  });
}

/**
 * Accept a conflicting payload as the real correction: overwrite the form's stored payload with
 * it and re-enter the pipeline from scratch (status PENDING, attempts reset). This is the "fix by
 * hand and send" path — a human has looked at both versions and confirmed which one is right.
 *
 * Guarded so a conflict can only be applied once (idempotent under a double-click or retry) and so
 * an operator can never apply a conflict that belongs to a different form.
 */
export async function applyConflict(ingestedFormId: string, conflictId: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const resolved = await tx.formConflict.updateMany({
      where: { id: conflictId, ingestedFormId, resolution: null },
      data: { resolution: "applied", resolvedAt: new Date() },
    });
    if (resolved.count === 0) return false; // already resolved, or no such conflict on this form

    const conflict = await tx.formConflict.findUniqueOrThrow({ where: { id: conflictId } });
    await tx.ingestedForm.update({
      where: { id: ingestedFormId },
      data: {
        rawPayload: conflict.payload as Prisma.InputJsonValue,
        payloadHash: conflict.payloadHash,
        status: "PENDING",
        attempts: 0,
        claimedAt: null,
        nextAttemptAt: new Date(),
        lastError: null,
      },
    });
    return true;
  });
}

/** Reject a conflicting payload: leave the original form exactly as it is. */
export async function dismissConflict(ingestedFormId: string, conflictId: string): Promise<boolean> {
  const resolved = await prisma.formConflict.updateMany({
    where: { id: conflictId, ingestedFormId, resolution: null },
    data: { resolution: "dismissed", resolvedAt: new Date() },
  });
  return resolved.count > 0;
}

function extractSessionId(payload: unknown): string | undefined {
  return extractString(payload, "session_id");
}

function extractString(payload: unknown, key: string): string | undefined {
  if (payload && typeof payload === "object" && key in payload) {
    const value = (payload as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }
  return undefined;
}
