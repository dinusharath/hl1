import { prisma } from "../../db/prisma";
import { MappingResolver, type MappingRule } from "./mapping-resolver";
import { KNOWN_MAPPINGS } from "./known-mappings";

/**
 * Build the resolver used at transform time: the built-in high-confidence dictionary as the base,
 * with active DB `field_mappings` layered ON TOP so an approved/auto-applied fix overrides a
 * built-in. Called once per worker tick (cheap) so a newly-activated mapping takes effect within
 * a tick with no deploy. A richer build would hot-reload via Postgres LISTEN/NOTIFY.
 */
export async function loadResolver(): Promise<MappingResolver> {
  const dbRules = await loadDbRules();
  return new MappingResolver(mergeRules(KNOWN_MAPPINGS, dbRules));
}

async function loadDbRules(): Promise<MappingRule[]> {
  const rows = await prisma.fieldMapping.findMany({ where: { active: true } });
  return rows.map((row): MappingRule => {
    switch (row.kind) {
      case "enum":
        return { kind: "enum", sourcePath: row.sourcePath, valueMap: asStringMap(row.valueMap) };
      case "format":
        return { kind: "format", sourcePath: row.sourcePath, valueMap: asStringMap(row.valueMap) };
      case "route":
        return { kind: "route", sourcePath: row.sourcePath, targetPath: row.targetPath };
      case "composite":
        // Stored migration-free: first source in source_path, the rest in fallback.
        return {
          kind: "composite",
          sourcePaths: [row.sourcePath, ...asStringArray(row.fallback)],
          targetPath: row.targetPath ?? row.sourcePath,
        };
      case "alias":
      default:
        return {
          kind: "alias",
          sourcePath: row.sourcePath,
          targetPath: row.targetPath ?? row.sourcePath,
          fallback: asStringArray(row.fallback),
        };
    }
  });
}

/**
 * De-duplicate so precedence is deterministic regardless of resolver internals: later rules win.
 * Aliases are keyed by target field; enum value-maps are overlaid per source field (DB keys win).
 */
function mergeRules(builtIns: MappingRule[], dbRules: MappingRule[]): MappingRule[] {
  const aliases = new Map<string, MappingRule>();
  const enums = new Map<string, Record<string, string>>();
  const others: MappingRule[] = [];

  for (const rule of [...builtIns, ...dbRules]) {
    if (rule.kind === "alias") {
      aliases.set(rule.targetPath, rule); // DB (added last) overrides a built-in for the same target
    } else if (rule.kind === "enum") {
      enums.set(rule.sourcePath, { ...(enums.get(rule.sourcePath) ?? {}), ...rule.valueMap });
    } else {
      others.push(rule);
    }
  }

  const enumRules: MappingRule[] = [...enums].map(([sourcePath, valueMap]) => ({ kind: "enum", sourcePath, valueMap }));
  return [...aliases.values(), ...enumRules, ...others];
}

function asStringMap(value: unknown): Record<string, string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k, String(v)]));
  }
  return {};
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}
