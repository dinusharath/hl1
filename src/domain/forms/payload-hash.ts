import { createHash } from "node:crypto";

/**
 * Deterministic hash of a payload, used to tell a true duplicate from a reused-id/changed-data
 * conflict (PLAN.md §"how do we know it's the same?").
 *
 * The payload is normalised first by sorting object keys recursively, so a mere key reorder by
 * the provider doesn't look like a content change. We deliberately do NOT trim string values:
 * a changed value (even just trailing whitespace) is a real content difference and should be
 * surfaced as a same-id/different-data conflict, not silently treated as a duplicate.
 */
export function hashPayload(payload: unknown): string {
  return createHash("sha256").update(canonicalize(payload)).digest("hex");
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    // Codepoint comparison, not localeCompare — locale-independent so the hash is stable
    // across environments/locales.
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`);
  return `{${entries.join(",")}}`;
}

/**
 * Derive the idempotency key for a payload. Prefers `session_id` (the provider's per-submission
 * UUID); if drift has dropped it, falls back to the content hash so byte-identical replays are
 * still deduped. Returns the key plus whether the fallback was used (for a soft flag).
 */
export function deriveIdempotencyKey(
  sessionId: string | undefined,
  payloadHash: string,
): { key: string; usedFallback: boolean } {
  if (sessionId && sessionId.trim()) {
    return { key: sessionId.trim(), usedFallback: false };
  }
  return { key: `hash:${payloadHash}`, usedFallback: true };
}
