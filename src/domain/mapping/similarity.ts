/**
 * Deterministic string-similarity helpers used to score mapping suggestions (no LLM, no deps).
 */

/** Sørensen–Dice coefficient over character bigrams. Returns 0..1 (1 = identical). */
export function dice(a: string, b: string): number {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  if (x === y) return 1;
  if (x.length < 2 || y.length < 2) return 0;

  const bigrams = (s: string): Map<string, number> => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };

  const A = bigrams(x);
  const B = bigrams(y);
  let overlap = 0;
  let sizeA = 0;
  let sizeB = 0;
  A.forEach((v) => (sizeA += v));
  B.forEach((v) => (sizeB += v));
  A.forEach((v, g) => {
    const w = B.get(g);
    if (w) overlap += Math.min(v, w);
  });
  return (2 * overlap) / (sizeA + sizeB);
}

/** Split a field name into lowercase tokens: snake_case, kebab-case, spaces, and camelCase. */
export function tokenize(field: string): string[] {
  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[_\-\s]+/)
    .map((t) => t.toLowerCase())
    .filter(Boolean);
}

/** Fraction of the target's tokens that appear in the candidate (e.g. "email" ⊆ "work_email" = 1). */
export function tokenOverlap(candidate: string, target: string): number {
  const c = new Set(tokenize(candidate));
  const t = tokenize(target);
  if (t.length === 0) return 0;
  return t.filter((tok) => c.has(tok)).length / t.length;
}

/** Best of bigram similarity and token overlap — robust to renames like email → work_email. */
export function nameSimilarity(candidate: string, target: string): number {
  return Math.max(dice(candidate, target), tokenOverlap(candidate, target));
}
