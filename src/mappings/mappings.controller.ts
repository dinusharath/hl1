import type { Request, Response } from "express";
import { Prisma, type FieldMapping } from "@prisma/client";
import { createMapping, deactivateMapping, listMappings, type MappingInput } from "./mappings.service";

/** JSON-safe view of a mapping (Decimal → number, dates → ISO). */
function toView(m: FieldMapping) {
  return {
    id: m.id,
    kind: m.kind,
    sourcePath: m.sourcePath,
    targetPath: m.targetPath,
    valueMap: m.valueMap,
    fallback: m.fallback,
    scope: m.scope,
    version: m.version,
    active: m.active,
    confidence: m.confidence === null ? null : Number(m.confidence),
    sourceEngine: m.sourceEngine,
    approvedBy: m.approvedBy,
    createdAt: m.createdAt,
    deactivatedAt: m.deactivatedAt,
  };
}

export async function listMappingsHandler(req: Request, res: Response): Promise<void> {
  const includeInactive = req.query.includeInactive === "true";
  const rows = await listMappings(includeInactive);
  res.json(rows.map(toView));
}

const KINDS = ["alias", "enum", "format", "route", "composite"] as const;

export async function createMappingHandler(req: Request, res: Response): Promise<void> {
  const b = req.body as Partial<MappingInput>;
  if (!b || typeof b.sourcePath !== "string" || !b.kind || !KINDS.includes(b.kind)) {
    res.status(400).json({ error: "kind (alias|enum|format|route|composite) and sourcePath are required" });
    return;
  }
  try {
    const created = await createMapping(
      {
        kind: b.kind,
        sourcePath: b.sourcePath,
        targetPath: b.targetPath ?? null,
        valueMap: b.valueMap ?? null,
        fallback: Array.isArray(b.fallback) ? b.fallback : [],
        scope: b.scope === "future" ? "future" : "all",
      },
      "operator",
    );
    res.status(201).json(toView(created));
  } catch (err) {
    // Concurrent create for the same (kind, source_path, target_path) slot hits the partial
    // unique index — a conflict, not a server error. Tell the caller to re-fetch and retry.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      res.status(409).json({ error: "a mapping for this slot was just created — refresh and retry" });
      return;
    }
    throw err;
  }
}

export async function deactivateMappingHandler(req: Request, res: Response): Promise<void> {
  const ok = await deactivateMapping(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
}
