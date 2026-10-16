import { prisma } from "../../db/prisma";
import { env } from "../../config/env";

export type AutoDecision = "auto-apply" | "needs-review";

/** The minimal shape of a drift suggestion the policy needs. */
export interface MappingSuggestion {
  // `composite` merges several sources into one target; its extra sources ride in `fallback`.
  kind: "alias" | "enum" | "format" | "route" | "composite";
  sourcePath: string;
  targetPath?: string | null;
  valueMap?: Record<string, string>;
  fallback?: string[];
  confidence: number;
  observationId?: string;
}

/**
 * Pure policy: is this suggestion confident enough to apply without a human?
 * At/above the threshold → auto-apply; below → needs-review. No side effects, trivially testable.
 */
export function decide(
  suggestion: { confidence: number; kind?: string },
  threshold: number = env.autoApply.confidence,
): AutoDecision {
  // A composite (merging several fields into one) is never auto-applied: whether split fields
  // should be *joined* or are *alternatives* can't be settled from names alone, so a human confirms.
  if (suggestion.kind === "composite") return "needs-review";
  return suggestion.confidence >= threshold ? "auto-apply" : "needs-review";
}

export interface ApplyResult {
  decision: AutoDecision;
  mappingId?: string;
  version?: number;
}

/**
 * Apply a suggestion if it clears the confidence bar, else report that it needs review.
 *
 * Auto-apply writes an ACTIVE `field_mappings` row (approved_by='auto', source_engine='rule') and
 * is fully reversible — the previous active mapping for the same slot is deactivated (append-only,
 * one active per slot), and the new row can be rolled back by flipping its `active` flag. Every
 * write is audited via approved_by / created_at / observation_id.
 *
 * Suggestions (with a computed confidence) come from the deterministic rule-based engine in
 * `suggest.ts` — name-similarity + value-shape for renames, synonym/nearest-match for enums,
 * format detection for formats (no LLM). An LLM fallback for genuinely ambiguous cases, and the
 * drift-detection pipeline that records observations + fires replay, remain roadmap.
 */
export async function applyOrQueue(
  suggestion: MappingSuggestion,
  threshold: number = env.autoApply.confidence,
): Promise<ApplyResult> {
  const decision = decide(suggestion, threshold);
  if (decision === "needs-review") {
    return { decision };
  }

  // A "slot" is (kind, source_path, target_path) — exactly the columns of the partial unique
  // index that enforces one active mapping per slot. The deactivation below must match it so we
  // never silently retire a sibling mapping to a *different* target for the same source.
  const targetPath = suggestion.targetPath ?? null;

  const created = await prisma.$transaction(async (tx) => {
    // Next version for this slot.
    const latest = await tx.fieldMapping.findFirst({
      where: { kind: suggestion.kind, sourcePath: suggestion.sourcePath, targetPath },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const version = (latest?.version ?? 0) + 1;

    // Deactivate the current active mapping for this exact slot (append-only history, one active).
    await tx.fieldMapping.updateMany({
      where: { kind: suggestion.kind, sourcePath: suggestion.sourcePath, targetPath, active: true },
      data: { active: false, deactivatedAt: new Date() },
    });

    return tx.fieldMapping.create({
      data: {
        kind: suggestion.kind,
        sourcePath: suggestion.sourcePath,
        targetPath,
        valueMap: suggestion.valueMap ?? undefined,
        fallback: suggestion.fallback ?? [],
        version,
        active: true,
        confidence: suggestion.confidence,
        sourceEngine: "rule",
        approvedBy: "auto",
        observationId: suggestion.observationId ?? null,
      },
      select: { id: true, version: true },
    });
  });

  return { decision, mappingId: created.id, version: created.version };
}
