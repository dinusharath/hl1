/**
 * Applies approved field mappings (from the `field_mappings` table) to a raw payload
 * *before* it is parsed and transformed. This is how a human-approved fix for schema drift
 * takes effect with no code change (PLAN.md §4, Self-healing schema drift).
 *
 * The resolver is a pure, in-memory view of the active mappings. Loading them from the DB and
 * hot-reloading on change is a separate concern (a repository), keeping this unit-testable.
 */

export type MappingRule =
  | { kind: "alias"; sourcePath: string; targetPath: string; fallback?: string[] }
  | { kind: "enum"; sourcePath: string; valueMap: Record<string, string> }
  | { kind: "format"; sourcePath: string; valueMap: Record<string, string> }
  | { kind: "route"; sourcePath: string; targetPath: string | null }
  // Merge several source fields into one target (e.g. firstName + lastName -> name). The generic
  // N->1 counterpart to `alias` (1->1); providers that split a field apart are resolved here.
  | { kind: "composite"; sourcePaths: string[]; targetPath: string; separator?: string };

type RawObject = Record<string, unknown>;

export class MappingResolver {
  private readonly rules: MappingRule[];

  constructor(rules: MappingRule[] = []) {
    this.rules = rules;
  }

  static empty(): MappingResolver {
    return new MappingResolver([]);
  }

  /**
   * Fill fields the schema expects from their aliased sources. Returns a shallow copy plus the
   * list of target fields that were populated by an alias (for a soft flag). Non-destructive:
   * an alias only fires when the target is absent/empty.
   */
  applyAliases(raw: RawObject): { raw: RawObject; applied: string[] } {
    const out: RawObject = { ...raw };
    const applied: string[] = [];

    for (const rule of this.rules) {
      if (rule.kind !== "alias") continue;
      if (hasValue(out[rule.targetPath])) continue;

      const sources = [rule.sourcePath, ...(rule.fallback ?? [])];
      const chosen = sources.find((s) => hasValue(out[s]));
      if (chosen) {
        out[rule.targetPath] = out[chosen];
        applied.push(rule.targetPath);
      }
    }

    return { raw: out, applied };
  }

  /**
   * Fill a target from several source fields joined together (e.g. `name` from `firstName` +
   * `lastName`). Non-destructive, like `applyAliases`: only fires when the target is absent/empty,
   * so a provider that already sends `name` is untouched. Only the sources actually present are
   * joined (with a single space by default), so a lone `firstName` still yields a usable value.
   */
  applyComposites(raw: RawObject): { raw: RawObject; applied: string[] } {
    const out: RawObject = { ...raw };
    const applied: string[] = [];

    for (const rule of this.rules) {
      if (rule.kind !== "composite") continue;
      if (hasValue(out[rule.targetPath])) continue;

      const parts = rule.sourcePaths.map((s) => out[s]).filter(hasValue).map((v) => String(v).trim());
      if (parts.length === 0) continue;

      out[rule.targetPath] = parts.join(rule.separator ?? " ");
      applied.push(rule.targetPath);
    }

    return { raw: out, applied };
  }

  /** Value remaps for a field (e.g. gender), merged from all matching `enum` rules. */
  enumMapFor(field: string): Record<string, string> {
    return this.rules
      .filter((r): r is Extract<MappingRule, { kind: "enum" }> => r.kind === "enum" && r.sourcePath === field)
      .reduce<Record<string, string>>((acc, r) => ({ ...acc, ...r.valueMap }), {});
  }
}

function hasValue(v: unknown): boolean {
  return v !== undefined && v !== null && v !== "";
}
