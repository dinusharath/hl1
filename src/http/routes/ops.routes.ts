import { Router, type Request, type Response } from "express";
import { healthHandler, readyHandler } from "../health.controller";
import { asyncHandler } from "../async-handler";
import { openApiSpec } from "../openapi";

/** Operational + discovery routes: service index, API docs, liveness, readiness. All public. */
export const opsRoutes = Router();

const DOCS_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Healthtech Ingestion API</title>
<meta name="viewport" content="width=device-width, initial-scale=1"></head><body>
<script id="api-reference" data-url="/openapi.json"></script>
<script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body></html>`;

opsRoutes.get("/", (_req: Request, res: Response) => {
  res.json({ service: "healthtech-ingestion", status: "ok", docs: "/docs", openapi: "/openapi.json" });
});
opsRoutes.get("/openapi.json", (_req: Request, res: Response) => res.json(openApiSpec));
opsRoutes.get("/docs", (_req: Request, res: Response) => res.type("html").send(DOCS_HTML));
opsRoutes.get("/health", healthHandler);
opsRoutes.get("/ready", asyncHandler(readyHandler));
