import { Prisma } from "@prisma/client";

/**
 * Error taxonomy — decides retry vs fail-fast (PLAN.md §Error taxonomy).
 *
 * The worker classifies every failure into exactly one of these so a transient
 * blip is retried, a bad-data case waits for a human, and a bug in our own code
 * surfaces immediately instead of silently burning the retry budget.
 */

/** Transient: 5xx, timeout, DB deadlock/connection blip. Safe to retry with backoff. */
export class RetryableError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "RetryableError";
  }
}

/** Data problem we can't resolve (ambiguous / unmapped). Route to NEEDS_REVIEW for a human. */
export class ReviewError extends Error {
  constructor(message: string, readonly reasons: string[] = [message]) {
    super(message);
    this.name = "ReviewError";
  }
}

/** Deterministic failure — our bug or a 4xx. Retrying won't help: go to FAILED, keep the stack. */
export class PermanentError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "PermanentError";
  }
}

// Prisma engine/connection errors that are transient by nature.
const RETRYABLE_PRISMA_CODES = new Set(["P1001", "P1002", "P1008", "P1017", "P2024", "P2034"]);

/** PG SQLSTATEs worth retrying: serialization failure, deadlock, connection class, admin shutdown. */
function isTransientSqlState(code: string | undefined): boolean {
  if (!code) return false;
  return code === "40001" || code === "40P01" || code.startsWith("08") || code === "57P01";
}

/** True when a thrown DB error is a transient blip rather than a real data/logic fault. */
function isTransientDbError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true; // can't reach DB yet
  if (err instanceof Prisma.PrismaClientUnknownRequestError) return true; // engine hiccup
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (RETRYABLE_PRISMA_CODES.has(err.code)) return true;
    // Raw-query failures surface as P2010 with the underlying PG SQLSTATE in meta.code.
    const meta = err.meta as { code?: string } | undefined;
    if (err.code === "P2010" && isTransientSqlState(meta?.code)) return true;
  }
  return false;
}

/**
 * Classify an unknown thrown value. Transient DB errors become Retryable; everything else
 * unknown defaults to *permanent* so a real code bug is seen by a human rather than retried
 * forever.
 */
export function classify(err: unknown): RetryableError | ReviewError | PermanentError {
  if (err instanceof RetryableError || err instanceof ReviewError || err instanceof PermanentError) {
    return err;
  }
  const message = err instanceof Error ? err.message : String(err);
  if (isTransientDbError(err)) {
    return new RetryableError(message, err);
  }
  return new PermanentError(message, err);
}
