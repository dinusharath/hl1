import { RetryableError } from "../domain/errors";

/**
 * Run a provider call against a timeout. A hung provider is a transient problem, so a timeout
 * surfaces as a RetryableError — the worker backs off and tries again.
 *
 * The work is given an AbortSignal that fires on timeout. Our mock providers ignore it, but a
 * real HTTP client (fetch/undici/axios) would use it to actually cancel the in-flight request
 * rather than leaking it.
 */
export async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  const timeout = new Promise<never>((_, reject) => {
    controller.signal.addEventListener("abort", () =>
      reject(new RetryableError(`${label} timed out after ${ms}ms`)),
    );
  });
  try {
    return await Promise.race([run(controller.signal), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
