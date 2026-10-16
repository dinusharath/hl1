import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Authorization layer — STRUCTURE IS REAL, IDENTITY BACKEND IS A PLACEHOLDER.
 *
 * Every console route is guarded by a named permission (RBAC). What is mocked is only *who the
 * caller is*: `resolvePrincipal` returns a stand-in principal instead of verifying a real session,
 * JWT, or API key. Swapping in real auth is a single-function change here — the route guards,
 * permission names, and 401/403 semantics stay exactly as they are.
 *
 * Enforcement is OFF by default (AUTH_ENFORCE=false) so local dev, the demo UI, and tests work
 * without credentials; set AUTH_ENFORCE=true to exercise the checks. In production this would be
 * forced on and `resolvePrincipal` would do real identity verification.
 */

export interface Principal {
  id: string;
  roles: string[];
  permissions: Set<string>;
}

// RBAC: which permissions each role holds. The operator runs the console; a viewer is read-only.
const PERMISSIONS_BY_ROLE: Record<string, string[]> = {
  operator: ["forms:read", "forms:replay", "mappings:read", "mappings:write", "drift:read", "drift:write"],
  viewer: ["forms:read", "mappings:read", "drift:read"],
};

const ENFORCE = process.env.AUTH_ENFORCE === "true";

/**
 * PLACEHOLDER identity resolution. Replace the body with real verification (session cookie / bearer
 * JWT / API key → user → roles). Until then it trusts an `x-role` header (default `operator`) so the
 * guard shape is exercised without a real auth backend. Returns null for an unknown/invalid caller.
 */
function resolvePrincipal(req: Request): Principal | null {
  const role = (req.header("x-role") ?? "operator").toLowerCase();
  const permissions = PERMISSIONS_BY_ROLE[role];
  if (!permissions) return null; // unknown role → unauthenticated
  return { id: `mock-${role}`, roles: [role], permissions: new Set(permissions) };
}

/** Guard a route with a required permission. Attaches the resolved principal to the request. */
export function requirePermission(permission: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const principal = resolvePrincipal(req);
    if (!ENFORCE) {
      // Non-enforcing (local/dev/test): still attach a principal so handlers can read it.
      (req as Request & { principal?: Principal }).principal = principal ?? { id: "mock-operator", roles: ["operator"], permissions: new Set(PERMISSIONS_BY_ROLE.operator) };
      next();
      return;
    }
    if (!principal) {
      res.status(401).json({ error: "unauthenticated" });
      return;
    }
    if (!principal.permissions.has(permission)) {
      res.status(403).json({ error: `forbidden: requires '${permission}'` });
      return;
    }
    (req as Request & { principal?: Principal }).principal = principal;
    next();
  };
}

/**
 * PLACEHOLDER provider authentication for the ingest webhook. A real implementation verifies an
 * HMAC signature (e.g. `x-signature`) against a shared secret with replay protection, per the
 * provider contract. Enforcement is gated the same way; by default it allows the request through.
 */
export function verifyProvider(req: Request, res: Response, next: NextFunction): void {
  if (!ENFORCE) {
    next();
    return;
  }
  const signature = req.header("x-signature");
  if (!signature) {
    res.status(401).json({ error: "missing provider signature" });
    return;
  }
  // TODO: constant-time HMAC verification of the raw body against INGEST_SIGNING_SECRET + timestamp/replay check.
  next();
}
