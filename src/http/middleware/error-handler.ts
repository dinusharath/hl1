import type { NextFunction, Request, Response } from "express";

/**
 * Terminal error middleware. Client errors (malformed JSON, oversized body) are 4xx and MUST NOT
 * become 5xx — a 5xx tells the provider to resend, which would loop forever on input we will never
 * accept. Everything unexpected is a generic 500 with no internal detail leaked to the caller.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof SyntaxError) {
    res.status(400).json({ error: "request body is not valid JSON" });
    return;
  }
  const status = (err as { status?: number; statusCode?: number })?.status ?? (err as { statusCode?: number })?.statusCode;
  if (typeof status === "number" && status >= 400 && status < 500) {
    res.status(status).json({ error: "request rejected" }); // e.g. 413 Payload Too Large
    return;
  }
  res.status(500).json({ error: "internal error" });
}
