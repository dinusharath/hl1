import { Router } from "express";
import { ingestHandler } from "../../ingest/ingest.controller";
import { asyncHandler } from "../async-handler";
import { verifyProvider } from "../auth";

/** Provider ingress. Authenticated by provider signature (placeholder), not the console RBAC. */
export const ingestRoutes = Router();

ingestRoutes.post("/ingest", verifyProvider, asyncHandler(ingestHandler));
