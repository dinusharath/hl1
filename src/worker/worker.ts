import { env } from "../config/env";
import { claimForms } from "./claim";
import { processForm } from "./process-form";
import { dispatchOutbox } from "./outbox-dispatcher";
import { loadResolver } from "../domain/mapping/load-mappings";
import { Geocoder } from "../providers/geocoder";
import { logger } from "../observability/logger";

/**
 * The worker loop. Each tick: claim a batch of forms, run each through the pipeline in its own
 * try/catch (processForm never throws), then dispatch the outbox. Single-process here, but every
 * guarantee lives in the DB, so running several of these concurrently is safe.
 */
export class Worker {
  private running = false;
  private currentTick?: Promise<void>;
  private readonly geocoder = new Geocoder(undefined, env.providers.timeoutMs);

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    logger.info("worker started");
    void this.loop();
  }

  /** Stop claiming new work and await the in-flight tick so shutdown doesn't cut it off. */
  async stop(): Promise<void> {
    this.running = false;
    logger.info("worker stopping — draining in-flight tick");
    await this.currentTick;
  }

  private async loop(): Promise<void> {
    while (this.running) {
      this.currentTick = this.tick();
      try {
        await this.currentTick;
      } catch (err) {
        // A tick-level failure (e.g. DB blip) must not kill the loop.
        logger.error({ err }, "worker tick failed");
      }
      if (!this.running) break;
      await sleep(env.worker.pollIntervalMs);
    }
  }

  private async tick(): Promise<void> {
    const resolver = await loadResolver();
    const forms = await claimForms(env.worker.batchSize, env.worker.leaseMs, env.worker.maxAttempts);

    for (const form of forms) {
      await processForm(form, { resolver, geocoder: this.geocoder, maxAttempts: env.worker.maxAttempts });
    }

    await dispatchOutbox(env.worker.batchSize, env.worker.leaseMs, {
      emailMaxAttempts: env.worker.emailMaxAttempts,
    });
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const worker = new Worker();

// Allow running the worker as its own process: `npm run worker`.
if (require.main === module) {
  void worker.start();
  process.on("SIGTERM", () => void worker.stop());
  process.on("SIGINT", () => void worker.stop());
}
