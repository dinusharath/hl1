import pino from "pino";

/**
 * Structured logger. We log identifiers and status — never the full payload, which is PHI.
 * `session_id` is the correlation id that ties a form's logs together across the pipeline.
 */
export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: undefined, // drop pid/hostname noise
});

/** A child logger bound to a form, so every line carries its correlation ids. */
export function formLogger(ids: { formId?: string; sessionId?: string | null }) {
  return logger.child({ formId: ids.formId, sessionId: ids.sessionId ?? undefined });
}
