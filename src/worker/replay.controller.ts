import type { Request, Response } from "express";
import { replayAll, replayForm } from "./replay";

export async function replayFormHandler(req: Request, res: Response): Promise<void> {
  const ok = await replayForm(req.params.id);
  res.status(ok ? 200 : 404).json({ ok });
}

export async function replayAllHandler(req: Request, res: Response): Promise<void> {
  const status = req.body?.status === "FAILED" ? "FAILED" : "NEEDS_REVIEW";
  const count = await replayAll(status);
  res.json({ count, status });
}
