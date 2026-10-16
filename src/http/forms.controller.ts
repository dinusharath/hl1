import type { Request, Response } from "express";
import { prisma } from "../db/prisma";
import { listConflicts, applyConflict, dismissConflict } from "../ingest/ingest.service";
import { applyManualFix, type MappingInput } from "../mappings/mappings.service";

const MAPPING_KINDS = ["alias", "enum", "format", "route", "composite"] as const;
function isMappingInput(v: unknown): v is MappingInput {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return typeof r.sourcePath === "string" && typeof r.kind === "string" && (MAPPING_KINDS as readonly string[]).includes(r.kind);
}

/**
 * Plain-language, action-oriented explanation of each status for a non-technical on-call reader.
 * The raw `status` is still returned alongside for engineers.
 */
const STATUS_MESSAGE: Record<string, string> = {
  PENDING: "In progress — nothing to do, it will be picked up shortly.",
  PROCESSING: "In progress — being worked on right now.",
  TRANSFORMED: "In progress — details cleaned up, finishing enrichment.",
  GEOCODED: "In progress — location added, about to be sent on.",
  DISPATCHED: "In progress — being delivered now.",
  DONE: "Completed — fully processed and delivered.",
  NEEDS_REVIEW: "Waiting on your decision — open the Drift Console to approve a fix.",
  FAILED: "Needs an engineer — already queued for the dev team; nothing for you to do.",
};

/**
 * GET /forms/:id — a PII-free trace for on-call: status, soft flags, retry count, last error, and
 * the state of each delivery. We never echo the person's data (name/email/DOB/coordinates) — only
 * shapes and codes — so the troubleshooting view is safe to expose. (PLAN §10.)
 */
/**
 * GET /stats — real counts by status (DB aggregation) for the dashboard. No PII.
 */
export async function statsHandler(_req: Request, res: Response): Promise<void> {
  const grouped = await prisma.ingestedForm.groupBy({ by: ["status"], _count: { _all: true } });
  const byStatus: Record<string, number> = {};
  for (const g of grouped) byStatus[g.status] = g._count._all;
  const total = grouped.reduce((sum, g) => sum + g._count._all, 0);
  const inProgress =
    (byStatus.PENDING ?? 0) + (byStatus.PROCESSING ?? 0) + (byStatus.TRANSFORMED ?? 0) +
    (byStatus.GEOCODED ?? 0) + (byStatus.DISPATCHED ?? 0);
  res.json({
    total,
    inProgress,
    done: byStatus.DONE ?? 0,
    needsReview: byStatus.NEEDS_REVIEW ?? 0,
    failed: byStatus.FAILED ?? 0,
    byStatus,
  });
}

/**
 * GET /forms?status=…  — a redacted list for the UI/ops: newest first, no PII.
 */
export async function listFormsHandler(req: Request, res: Response): Promise<void> {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const forms = await prisma.ingestedForm.findMany({
    where: status ? { status: status as never } : undefined,
    orderBy: { receivedAt: "desc" },
    take: 100,
    include: { outbox: true },
  });
  res.json(
    forms.map((f) => ({
      id: f.id,
      applicationReference: f.applicationReference,
      sessionId: f.sessionId,
      status: f.status,
      statusMessage: STATUS_MESSAGE[f.status] ?? f.status,
      attempts: f.attempts,
      duplicateCount: f.duplicateCount,
      flagsCount: Array.isArray(f.flags) ? f.flags.length : 0,
      outbox: f.outbox.map((o) => ({ type: o.type, status: o.status })),
      receivedAt: f.receivedAt,
    })),
  );
}

export async function getFormHandler(req: Request, res: Response): Promise<void> {
  const form = await prisma.ingestedForm.findUnique({
    where: { id: req.params.id },
    include: { outbox: true, transformed: true },
  });

  if (!form) {
    res.status(404).json({ error: "form not found" });
    return;
  }

  const pendingConflicts = await prisma.formConflict.count({ where: { ingestedFormId: form.id, resolution: null } });

  res.json({
    id: form.id,
    sessionId: form.sessionId, // idempotency/correlation key, not PII
    status: form.status,
    statusMessage: STATUS_MESSAGE[form.status] ?? form.status, // plain-language for non-technical readers
    flags: form.flags, // already PII-free (codes + shapes)
    attempts: form.attempts,
    duplicateCount: form.duplicateCount,
    lastError: form.lastError, // PII-free messages only
    receivedAt: form.receivedAt,
    transformed: form.transformed
      ? { exists: true, geocoded: form.transformed.longitude !== null && form.transformed.latitude !== null }
      : { exists: false },
    outbox: form.outbox.map((o) => ({ type: o.type, status: o.status, attempts: o.attempts, lastError: o.lastError })),
    // A session_id reused with different data never overwrites the original (see ingest.service) —
    // it waits here, visible regardless of the form's own status, for an operator to resolve.
    pendingConflicts,
  });
}

/**
 * GET /forms/:id/conflicts — the actual conflicting payloads an operator needs to see to decide
 * which version is correct. This is the one place raw provider data is exposed by the API: an
 * authorized operator reconciling a reused session_id must see the real values, not a redaction.
 */
export async function listConflictsHandler(req: Request, res: Response): Promise<void> {
  const rows = await listConflicts(req.params.id);
  res.json(rows.map((c) => ({
    id: c.id,
    payload: c.payload,
    receivedAt: c.receivedAt,
    resolution: c.resolution,
    resolvedAt: c.resolvedAt,
  })));
}

/**
 * GET /forms/:id/payload — the raw fields an operator needs to draw a mapping by hand for a
 * NEEDS_REVIEW form with no (or no confident) suggestion. Like /forms/:id/conflicts, this is the
 * one surface where raw provider data is shown — to an authorized operator fixing a stuck form,
 * not to the public API.
 */
export async function getFormPayloadHandler(req: Request, res: Response): Promise<void> {
  const form = await prisma.ingestedForm.findUnique({ where: { id: req.params.id }, select: { rawPayload: true } });
  if (!form) {
    res.status(404).json({ error: "form not found" });
    return;
  }
  res.json({ rawPayload: form.rawPayload });
}

/**
 * POST /forms/:id/manual-map — the dead-end fix: an operator maps the stuck form's own fields by
 * hand (one or more sources -> one target each) and sends it on. `save` picks the blast radius —
 * persist as a reusable mapping, or apply to just this form. See mappings.service.applyManualFix.
 */
export async function manualMapHandler(req: Request, res: Response): Promise<void> {
  const body = req.body as { rules?: unknown; save?: unknown };
  const rules = Array.isArray(body.rules) ? body.rules : [];
  if (rules.length === 0 || !rules.every(isMappingInput)) {
    res.status(400).json({ error: "rules must be a non-empty array of { kind, sourcePath, targetPath?, valueMap?, fallback? }" });
    return;
  }
  const result = await applyManualFix(req.params.id, rules, body.save === true, "operator");
  res.status(result.ok ? 200 : 404).json(result);
}

/** POST /forms/:id/conflicts/:conflictId/apply — accept this payload as the correction; re-enters the pipeline. */
export async function applyConflictHandler(req: Request, res: Response): Promise<void> {
  const ok = await applyConflict(req.params.id, req.params.conflictId);
  res.status(ok ? 200 : 404).json({ ok });
}

/** POST /forms/:id/conflicts/:conflictId/dismiss — reject this payload; the original form is untouched. */
export async function dismissConflictHandler(req: Request, res: Response): Promise<void> {
  const ok = await dismissConflict(req.params.id, req.params.conflictId);
  res.status(ok ? 200 : 404).json({ ok });
}
