import type { MappingSuggestion } from "./auto-apply";
import { nameSimilarity, dice } from "./similarity";
import { KNOWN_MAPPINGS } from "./known-mappings";

/**
 * Deterministic, rule-based suggestion engine (NO LLM). Given a drift signal it proposes a mapping
 * and computes a confidence score from measurable evidence:
 *   - rename  → field-name similarity + whether the incoming value fits the target's shape
 *   - enum    → a known synonym (high) or nearest allowed value by similarity
 *   - format  → which known format the value unambiguously matches
 *
 * The score feeds `auto-apply.decide()` (≥ threshold → auto-apply, else human review). An LLM
 * fallback for genuinely ambiguous cases remains the roadmap — this covers the common, scorable ones.
 */

export type DriftSignal =
  | { kind: "rename"; missingField: string; candidates: { field: string; sampleValue?: string }[] }
  | { kind: "enum"; field: string; value: string; allowed?: string[]; synonyms?: Record<string, string> }
  | { kind: "format"; field: string; value: string };

export interface ScoredSuggestion extends MappingSuggestion {
  confidence: number;
  rationale: string;
}

const round = (n: number): number => Math.round(Math.min(1, Math.max(0, n)) * 1000) / 1000;

/** Rank a field for composite ordering: given/first part (0) leads, family/last part (2) trails. */
function namePartRank(field: string): number {
  const f = field.toLowerCase();
  if (/(first|fore|given|christian)/.test(f)) return 0;
  if (/(last|sur|family)/.test(f)) return 2;
  return 1;
}

/** Does an incoming value look like the target schema field's expected shape? */
const SHAPE: Record<string, (v: string) => boolean> = {
  email: (v) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.trim()),
  mobile_number: (v) => /^\+?[\d\s()-]{7,}$/.test(v.trim()),
  phone_number: (v) => /^\+?[\d\s()-]{5,}$/.test(v.trim()),
  postcode: (v) => /^[A-Za-z]{1,2}\d[A-Za-z\d]?\s*\d[A-Za-z]{2}$/.test(v.trim()),
  date_of_birth: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v.trim()) || /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(v.trim()),
};

const DEFAULT_ALLOWED: Record<string, string[]> = { gender: ["male", "female", "prefer-not-to-say"] };

/** Synonyms for a field, drawn from the built-in rule dictionary (e.g. gender). */
function synonymsFor(field: string): Record<string, string> {
  const rule = KNOWN_MAPPINGS.find((r) => r.kind === "enum" && r.sourcePath === field);
  return rule && rule.kind === "enum" ? rule.valueMap : {};
}

export function suggest(signal: DriftSignal): ScoredSuggestion | null {
  switch (signal.kind) {
    case "rename": return suggestRename(signal);
    case "enum": return suggestEnum(signal);
    case "format": return suggestFormat(signal);
  }
}

function suggestRename(s: Extract<DriftSignal, { kind: "rename" }>): ScoredSuggestion | null {
  const hasShape = Object.prototype.hasOwnProperty.call(SHAPE, s.missingField);
  const scored = s.candidates
    .map((c) => {
      const nameScore = nameSimilarity(c.field, s.missingField);
      // Value evidence: if we know the target's shape and have a sample, reward a match.
      const valueScore =
        hasShape && c.sampleValue !== undefined ? (SHAPE[s.missingField](c.sampleValue) ? 1 : 0.25) : null;
      const score = valueScore === null ? nameScore : 0.55 * nameScore + 0.45 * valueScore;
      return { field: c.field, nameScore, valueScore, score };
    })
    .sort((a, b) => b.score - a.score);

  const best = scored[0];
  if (!best || best.score < 0.4) return null;

  // Composite vs alias. If the target has NO single-value shape (a free-text field like `name` or
  // an address line) and two or more fields independently look like it, they're probably *parts*
  // of it that were split apart — suggest merging them. For atomic/validated targets (email,
  // phone, postcode, dob) multiple matches mean *alternatives*, so we keep the alias+fallback below.
  const strong = scored.filter((c) => c.score >= 0.6).map((c) => c.field);
  if (!hasShape && strong.length >= 2) {
    // Order matters ("Grace Hopper", not "Hopper Grace") and payload key order is NOT reliable —
    // jsonb doesn't preserve insertion order. Rank by what the field name means: a given/first
    // part leads, a family/last part trails, anything else keeps a stable middle. A human still
    // confirms every composite, so this only needs to get the common split-name cases right.
    const inOrder = [...strong].sort((a, b) => namePartRank(a) - namePartRank(b));
    const confidence = round(Math.min(...scored.filter((c) => strong.includes(c.field)).map((c) => c.score), 0.98));
    return {
      kind: "composite",
      sourcePath: inOrder[0], // additional sources live in `fallback` (same columns, no migration)
      fallback: inOrder.slice(1),
      targetPath: s.missingField,
      confidence,
      rationale: `fields ${inOrder.join(" + ")} all resemble "${s.missingField}" — likely split apart`,
    };
  }

  // Single best → rename alias. Other strong candidates become ordered fallbacks (alternatives).
  const fallback = scored.slice(1).filter((c) => c.score >= 0.7).map((c) => c.field);
  const valueNote = best.valueScore === null ? "no value shape to check" : best.valueScore >= 1 ? "value matches the expected shape" : "value does not match the expected shape";

  return {
    kind: "alias",
    sourcePath: best.field,
    targetPath: s.missingField,
    fallback,
    confidence: round(Math.min(best.score, 0.98)),
    rationale: `name similarity ${best.nameScore.toFixed(2)}, ${valueNote}`,
  };
}

function suggestEnum(s: Extract<DriftSignal, { kind: "enum" }>): ScoredSuggestion | null {
  const key = s.value.trim().toLowerCase();
  const synonyms = { ...synonymsFor(s.field), ...(s.synonyms ?? {}) };
  const allowed = s.allowed ?? DEFAULT_ALLOWED[s.field] ?? [];

  // A known synonym is near-certain.
  if (synonyms[key]) {
    return { kind: "enum", sourcePath: s.field, valueMap: { [s.value]: synonyms[key] }, confidence: 0.97, rationale: "known synonym" };
  }
  // Otherwise map to the nearest allowed value by similarity.
  if (allowed.length === 0) return null;
  const ranked = allowed.map((a) => ({ a, sim: dice(key, a) })).sort((x, y) => y.sim - x.sim);
  const best = ranked[0];
  if (best.sim < 0.34) return null; // too weak to guess — let a human decide
  return {
    kind: "enum",
    sourcePath: s.field,
    valueMap: { [s.value]: best.a },
    confidence: round(0.45 + 0.5 * best.sim), // scaled: a weak match stays below the auto-apply bar
    rationale: `nearest allowed value "${best.a}" (similarity ${best.sim.toFixed(2)})`,
  };
}

const DATE_DMY = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function suggestFormat(s: Extract<DriftSignal, { kind: "format" }>): ScoredSuggestion | null {
  if (s.field === "date_of_birth") {
    const m = DATE_DMY.exec(s.value.trim());
    if (!m) return null;
    const a = Number(m[1]);
    const b = Number(m[2]);
    // If the first number can't be a month, the format is unambiguously DD/MM/YYYY.
    const unambiguous = a > 12 && b <= 12;
    return {
      kind: "format",
      sourcePath: s.field,
      valueMap: { from: "DD/MM/YYYY" },
      confidence: unambiguous ? 0.9 : 0.6,
      rationale: unambiguous ? "day > 12 forces DD/MM/YYYY" : "ambiguous day/month order — worth confirming",
    };
  }
  return null;
}
