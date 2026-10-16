import { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import { MappingResolver, type MappingRule } from "../domain/mapping/mapping-resolver";

/**
 * CRUD for field mappings — the DB-backed rules the transform applies at runtime. Updates take
 * effect on the next worker tick (no deploy, no PR). Append-only + `active` flag: an update is a
 * new version that supersedes the prior one for its slot; a rollback flips `active` off.
 */

export interface MappingInput {
  kind: "alias" | "enum" | "format" | "route" | "composite";
  sourcePath: string;
  targetPath?: string | null;
  valueMap?: Record<string, string> | null;
  fallback?: string[];
  scope?: "all" | "future";
}

/** A "slot" is (kind, source_path, target_path) — matches the partial unique index. */
function slotWhere(input: { kind: string; sourcePath: string; targetPath: string | null }) {
  return { kind: input.kind, sourcePath: input.sourcePath, targetPath: input.targetPath };
}

export async function listMappings(includeInactive = false) {
  return prisma.fieldMapping.findMany({
    where: includeInactive ? undefined : { active: true },
    orderBy: [{ sourcePath: "asc" }, { version: "desc" }],
  });
}

/**
 * Create (or supersede) a mapping. Append-only: the current active row for the slot is deactivated
 * and a new active version is written, in one transaction. Reversible via `deactivateMapping`.
 */
export async function createMapping(input: MappingInput, approvedBy: string) {
  const targetPath = input.targetPath ?? null;
  return prisma.$transaction(async (tx) => {
    const latest = await tx.fieldMapping.findFirst({
      where: slotWhere({ kind: input.kind, sourcePath: input.sourcePath, targetPath }),
      orderBy: { version: "desc" },
      select: { version: true },
    });
    await tx.fieldMapping.updateMany({
      where: { ...slotWhere({ kind: input.kind, sourcePath: input.sourcePath, targetPath }), active: true },
      data: { active: false, deactivatedAt: new Date() },
    });
    return tx.fieldMapping.create({
      data: {
        kind: input.kind,
        sourcePath: input.sourcePath,
        targetPath,
        valueMap: input.valueMap === null ? Prisma.DbNull : (input.valueMap as Prisma.InputJsonValue | undefined),
        fallback: (input.fallback ?? []) as Prisma.InputJsonValue,
        scope: input.scope ?? "all",
        version: (latest?.version ?? 0) + 1,
        active: true,
        confidence: new Prisma.Decimal(1),
        sourceEngine: "manual",
        approvedBy,
      },
    });
  });
}

/**
 * `MappingInput` always stores multiple sources as `sourcePath` (first) + `fallback` (the rest) —
 * one shape, migration-free, reused by aliases, composites, and the DB row itself. `MappingRule`
 * (the resolver's runtime shape) needs `alias` fallbacks kept as alternatives but a `composite`'s
 * sources collapsed into one `sourcePaths` array — same conversion `load-mappings.ts` does for
 * DB-stored rows.
 */
function toMappingRule(input: MappingInput): MappingRule {
  if (input.kind === "composite") {
    return {
      kind: "composite",
      sourcePaths: [input.sourcePath, ...(input.fallback ?? [])],
      targetPath: input.targetPath ?? input.sourcePath,
    };
  }
  if (input.kind === "alias") {
    return { kind: "alias", sourcePath: input.sourcePath, targetPath: input.targetPath ?? input.sourcePath, fallback: input.fallback ?? [] };
  }
  if (input.kind === "route") {
    return { kind: "route", sourcePath: input.sourcePath, targetPath: input.targetPath ?? null };
  }
  return { kind: input.kind, sourcePath: input.sourcePath, valueMap: input.valueMap ?? {} };
}

/** Roll back a mapping — deactivate it so the transform stops applying it (next tick). */
export async function deactivateMapping(id: string): Promise<boolean> {
  const res = await prisma.fieldMapping.updateMany({
    where: { id, active: true },
    data: { active: false, deactivatedAt: new Date() },
  });
  return res.count === 1;
}

/**
 * The hand-mapping path for a NEEDS_REVIEW form with no confident (or no) suggestion: an operator
 * draws the fix themselves from the fields actually on the stuck form, then sends it on. `save`
 * decides the blast radius:
 *   - true  → persisted via `createMapping` (same as the Mappings tab): every future form with
 *             this pattern is fixed automatically, no deploy.
 *   - false → applied to THIS form only (the resolved payload is written back onto its own row);
 *             no new rule is created, so the next drifted form still reaches review.
 * Either way the form re-enters the pipeline fresh (status PENDING, attempts reset).
 */
export async function applyManualFix(
  ingestedFormId: string,
  rules: MappingInput[],
  save: boolean,
  approvedBy: string,
): Promise<{ ok: boolean; mappingIds?: string[] }> {
  const form = await prisma.ingestedForm.findUnique({ where: { id: ingestedFormId } });
  if (!form) return { ok: false };

  const reEnter = { status: "PENDING" as const, attempts: 0, claimedAt: null, nextAttemptAt: new Date(), lastError: null };

  if (save) {
    // Each rule is its own append-only version (same as the Mappings tab) — not nested in a single
    // transaction with the status reset below, since `createMapping` opens its own transaction and
    // Prisma does not support nested interactive transactions.
    const mappingIds: string[] = [];
    for (const rule of rules) {
      const created = await createMapping(rule, approvedBy);
      mappingIds.push(created.id);
    }
    await prisma.ingestedForm.update({ where: { id: ingestedFormId }, data: reEnter });
    return { ok: true, mappingIds };
  }

  // Skip: resolve just this form's payload with the drawn rules, don't persist a rule.
  const resolver = new MappingResolver(rules.map(toMappingRule));
  const aliased = resolver.applyAliases(form.rawPayload as Record<string, unknown>);
  const resolved = resolver.applyComposites(aliased.raw).raw;
  await prisma.ingestedForm.update({
    where: { id: ingestedFormId },
    data: { rawPayload: resolved as Prisma.InputJsonValue, ...reEnter },
  });
  return { ok: true };
}
