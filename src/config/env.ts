/**
 * Environment configuration, validated once at boot.
 *
 * DATABASE_URL is required — we fail fast with a clear message rather than crashing later on
 * the first query. Everything else has a sensible default so local dev and tests Just Work.
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}. Copy .env.example to .env.`);
  }
  return value;
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`Environment variable ${name} must be a number, got "${raw}".`);
  }
  return parsed;
}

export const env = {
  databaseUrl: required("DATABASE_URL"),
  port: num("PORT", 3000),

  worker: {
    pollIntervalMs: num("WORKER_POLL_INTERVAL_MS", 1000),
    batchSize: num("WORKER_BATCH_SIZE", 10),
    leaseMs: num("WORKER_LEASE_MS", 30_000),
    maxAttempts: num("MAX_ATTEMPTS", 5),
    emailMaxAttempts: num("EMAIL_MAX_ATTEMPTS", 50),
  },

  providers: {
    geocoderFailureRate: num("GEOCODER_FAILURE_RATE", 0.05),
    emailFailureRate: num("EMAIL_FAILURE_RATE", 0.05),
    timeoutMs: num("PROVIDER_TIMEOUT_MS", 5000),
  },

  autoApply: {
    // A drift-mapping suggestion at or above this confidence is applied automatically
    // (approved_by='auto'); below it, a human reviews. Reversible via the active flag.
    confidence: num("AUTO_APPLY_CONFIDENCE", 0.95),
  },
} as const;

export type Env = typeof env;
