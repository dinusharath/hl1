import type { NextFunction, Request, Response } from "express";

/**
 * Permissive CORS for the local operator UI (a separate origin/port). A real deployment restricts
 * the allowed origin; this is a documented local-dev convenience (see README "Security & scope").
 */
export function cors(req: Request, res: Response, next: NextFunction): void {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Headers", "content-type, x-role, x-signature");
  res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
}
