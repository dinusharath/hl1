import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { detectDrift } from "./detect";
import { suggest } from "../mapping/suggest";
import type { DriftSignal } from "../mapping/suggest";
import { MappingResolver } from "../mapping/mapping-resolver";

/**
 * Records schema drift as aggregated observations (one row per issue), each with a computed
 * suggestion + confidence from the rule engine. Idempotent per form: a form id is only counted
 * once — enforced by `drift_observation_forms`' composite primary key, not by scanning an array —
 * so `count` is an accurate, UNCAPPED tally of distinct forms affected (safe across worker
 * retries). `sample_form_ids` stays capped for display; `count`/membership never do. PII-free.
 *
 * Drift is detected on the *resolved* payload (after active mappings run), so a pattern that a
 * built-in or approved mapping already fixes does not generate phantom review items.
 */

const SAMPLE_CAP = 20;

type FormLike = { id: string; rawPayload: unknown };

/** Apply active mappings first, so we only flag drift that is still unhandled. */
function resolvePayload(raw: unknown, resolver: MappingResolver): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const aliased = resolver.applyAliases(raw as Record<string, unknown>);
  return resolver.applyComposites(aliased.raw).raw;
}

function typeOf(signal: DriftSignal): string {
  return signal.kind === "rename" ? "likely_rename" : signal.kind === "enum" ? "unmapped_enum" : "format_change";
}
function fieldOf(signal: DriftSignal): string {
  return signal.kind === "rename" ? signal.missingField : signal.field;
}
function shapeOf(signal: DriftSignal): Prisma.InputJsonValue {
  if (signal.kind === "rename") return { missing: signal.missingField, arrived: signal.candidates.map((c) => c.field) };
  return { field: signal.field }; // value deliberately omitted — PII-free
}

export async function recordFromForm(form: FormLike, resolver: MappingResolver = MappingResolver.empty()): Promise<void> {
  const resolved = resolvePayload(form.rawPayload, resolver);
  for (const signal of detectDrift(resolved)) {
    const s = suggest(signal);
    const type = typeOf(signal);
    const fieldPath = fieldOf(signal);
    const suggestionJson = s
      ? JSON.stringify({ kind: s.kind, sourcePath: s.sourcePath, targetPath: s.targetPath ?? null, valueMap: s.valueMap ?? null, fallback: s.fallback ?? [] })
      : null;
    const shapeJson = JSON.stringify(shapeOf(signal));
    const confidence = s ? s.confidence : null;
    const source = s ? "rule" : null;

    // Three steps, one transaction — split because idempotent-per-form counting now needs a real
    // membership check (a composite PK), not an array-contains scan that silently breaks once the
    // array is capped.
    //
    // `applied` rows are terminal and never touched (and once a mapping is applied the resolver
    // handles the pattern, so no signal is even produced). A `dismissed` row, however, is REOPENED
    // when the provider keeps sending the pattern — otherwise dismissed drift would silently pile
    // forms into NEEDS_REVIEW with nothing visible to act on. Dismiss means "not now", not "hide
    // forever": recurrence brings it back (with the latest, possibly improved, suggestion).
    await prisma.$transaction(async (tx) => {
      // Step 1: upsert the observation's metadata (never its count/sample — those are step 3's
      // job). If the existing row is 'applied', the WHERE makes Postgres skip the update and
      // RETURNING yields nothing — detected below to skip steps 2/3 entirely for a resolved issue.
      const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
        INSERT INTO drift_observations
          (id, type, field_path, observed_shape, sample_form_ids, count, status, suggestion, confidence, source_engine, first_seen, last_seen)
        VALUES
          (gen_random_uuid()::text, ${type}, ${fieldPath}, ${shapeJson}::jsonb, ARRAY[]::text[],
           0, 'new', ${suggestionJson}::jsonb, ${confidence}, ${source}, now(), now())
        ON CONFLICT (type, field_path) DO UPDATE SET
          status = CASE WHEN drift_observations.status = 'dismissed' THEN 'new' ELSE drift_observations.status END,
          last_seen = now(),
          suggestion = ${suggestionJson}::jsonb,
          confidence = ${confidence},
          source_engine = ${source}
        WHERE drift_observations.status <> 'applied'
        RETURNING id
      `);
      if (rows.length === 0) return; // existing row is 'applied' — resolved, leave it alone

      const observationId = rows[0].id;

      // Step 2: the idempotency guard. A form retried mid-pipeline calls recordFromForm again for
      // the SAME form — the composite PK means a repeat is DO NOTHING, correctly uncounted.
      const membership = await tx.$queryRaw<{ x: number }[]>(Prisma.sql`
        INSERT INTO drift_observation_forms (observation_id, ingested_form_id)
        VALUES (${observationId}, ${form.id})
        ON CONFLICT (observation_id, ingested_form_id) DO NOTHING
        RETURNING 1 AS x
      `);
      if (membership.length === 0) return; // already counted for this observation — no-op

      // Step 3: this form is newly counted. `count` is UNCAPPED (true tally); `sample_form_ids`
      // stays capped at SAMPLE_CAP purely for display — the two are independent now.
      await tx.$executeRaw(Prisma.sql`
        UPDATE drift_observations SET
          count = count + 1,
          sample_form_ids = CASE
            WHEN cardinality(sample_form_ids) < ${SAMPLE_CAP} THEN array_append(sample_form_ids, ${form.id})
            ELSE sample_form_ids
          END
        WHERE id = ${observationId}
      `);
    });
  }
}

/** Every distinct form that has hit this observation — uncapped, for a complete replay on Approve. */
export async function listAffectedFormIds(observationId: string): Promise<string[]> {
  const rows = await prisma.driftObservationForm.findMany({
    where: { observationId },
    select: { ingestedFormId: true },
  });
  return rows.map((r) => r.ingestedFormId);
}
