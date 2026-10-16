/**
 * Exponential backoff with full jitter. Jitter spreads retries so a fleet of workers doesn't
 * stampede a recovering downstream in lockstep.
 */
export function backoffMs(attempts: number, baseMs = 1000, capMs = 5 * 60_000): number {
  const exponential = Math.min(capMs, baseMs * 2 ** Math.max(0, attempts));
  return Math.floor(Math.random() * exponential);
}

/** The timestamp a form/outbox row becomes eligible to retry. */
export function nextAttemptAt(attempts: number, baseMs?: number, capMs?: number): Date {
  return new Date(Date.now() + backoffMs(attempts, baseMs, capMs));
}
