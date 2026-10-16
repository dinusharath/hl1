import app from "./http/app";
import { env } from "./config/env";
import { worker } from "./worker/worker";
import { prisma } from "./db/prisma";
import { logger } from "./observability/logger";

/**
 * Process entry point: validate env (the `env` import fails fast if DATABASE_URL is missing),
 * start the HTTP server and the worker in one process, and shut both down gracefully on signal.
 */
const server = app.listen(env.port, () => {
  logger.info(`HTTP listening on :${env.port}`);
});

void worker.start();

async function shutdown(signal: string): Promise<void> {
  logger.info(`${signal} received — shutting down`);
  await worker.stop();
  await new Promise<void>((resolve) => server.close(() => resolve())); // let in-flight requests finish
  await prisma.$disconnect();
  process.exit(0);
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
