import type { Request, Response } from "express";
import type { DriftObservation } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { createMapping, type MappingInput } from "../../mappings/mappings.service";
import { replayForm } from "../../worker/replay";
import { listAffectedFormIds } from "./drift.service";

function confidenceLabel(c: number | null): string {
  if (c === null) return "no suggestion";
  if (c >= 0.85) return "Very likely correct";
  if (c >= 0.6) return "Worth a check";
  return "Low confidence";
}

function toView(o: DriftObservation) {
  const confidence = o.confidence === null ? null : Number(o.confidence);
  return {
    id: o.id,
    type: o.type,
    fieldPath: o.fieldPath,
    observedShape: o.observedShape,
    count: Number(o.count),
    status: o.status,
    suggestion: o.suggestion,
    confidence,
    confidenceLabel: confidenceLabel(confidence),
    sourceEngine: o.sourceEngine,
    sampleFormIds: o.sampleFormIds,
    firstSeen: o.firstSeen,
    lastSeen: o.lastSeen,
  };
}

export async function listDriftHandler(req: Request, res: Response): Promise<void> {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const rows = await prisma.driftObservation.findMany({
    // Default to only actionable observations — an approved ("applied") or dismissed one is resolved
    // and must drop off the Review queue, otherwise the UI re-fetches it straight back after Approve.
    where: status ? { status } : { status: { notIn: ["applied", "dismissed"] } },
    orderBy: { lastSeen: "desc" },
  });
  res.json(rows.map(toView));
}

export async function approveDriftHandler(req: Request, res: Response): Promise<void> {
  const obs = await prisma.driftObservation.findUnique({ where: { id: req.params.id } });
  if (!obs) {
    res.status(404).json({ ok: false, error: "no such observation" });
    return;
  }
  const s = obs.suggestion as (MappingInput & Record<string, unknown>) | null;
  if (!s || typeof s.kind !== "string" || typeof s.sourcePath !== "string") {
    res.status(422).json({ ok: false, error: "observation has no actionable suggestion" });
    return;
  }
  const mapping = await createMapping(
    { kind: s.kind, sourcePath: s.sourcePath, targetPath: s.targetPath ?? null, valueMap: s.valueMap ?? null, fallback: Array.isArray(s.fallback) ? s.fallback : [] },
    "operator",
  );
  await prisma.driftObservation.update({ where: { id: obs.id }, data: { status: "applied" } });
  // Replay EVERY form that hit this pattern, not just the capped display sample — the join table
  // (drift_observation_forms) holds the full, uncapped membership.
  const formIds = await listAffectedFormIds(obs.id);
  let replayed = 0;
  for (const formId of formIds) {
    if (await replayForm(formId)) replayed++;
  }
  res.json({ ok: true, mappingId: mapping.id, replayed, affected: formIds.length });
}

export async function dismissDriftHandler(req: Request, res: Response): Promise<void> {
  const r = await prisma.driftObservation.updateMany({ where: { id: req.params.id }, data: { status: "dismissed" } });
  res.status(r.count ? 200 : 404).json({ ok: r.count > 0 });
}
