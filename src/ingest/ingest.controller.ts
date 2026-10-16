import type { Request, Response } from "express";
import { ingestForm } from "./ingest.service";
import { logger } from "../observability/logger";

/**
 * POST /ingest.
 *
 * Durable front door: we persist the raw payload and only then return `202`. If the DB write
 * fails we return `5xx` so the (at-least-once) provider re-sends — we never acknowledge data we
 * didn't store. We never return `4xx` for a schema change; tolerance is handled downstream.
 *
 * Invalid JSON is the one genuine client error we reject (there's nothing to store), and the
 * body-size limit is enforced by the json parser in app.ts.
 */
export async function ingestHandler(req: Request, res: Response): Promise<void> {
  // express.json() leaves an empty object when the body is absent/!JSON content-type.
  if (req.body === undefined || req.body === null || typeof req.body !== "object") {
    res.status(400).json({ error: "request body must be a JSON object" });
    return;
  }

  try {
    const result = await ingestForm(req.body);
    // 202 Accepted: stored durably; processing happens asynchronously.
    res.status(202).json({ id: result.id, outcome: result.outcome, status: result.status });
  } catch (err) {
    logger.error({ err }, "ingest failed to persist");
    // Signal the provider to retry — the payload is NOT safely stored.
    res.status(503).json({ error: "could not persist form; please retry" });
  }
}
