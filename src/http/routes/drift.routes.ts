import { Router } from "express";
import { listDriftHandler, approveDriftHandler, dismissDriftHandler } from "../../domain/drift/drift.controller";
import { asyncHandler } from "../async-handler";
import { requirePermission } from "../auth";

/** Schema-drift review queue: list observations, approve (→ mapping + replay), or dismiss. */
export const driftRoutes = Router();

driftRoutes.get("/drift", requirePermission("drift:read"), asyncHandler(listDriftHandler));
driftRoutes.post("/drift/:id/approve", requirePermission("drift:write"), asyncHandler(approveDriftHandler));
driftRoutes.post("/drift/:id/dismiss", requirePermission("drift:write"), asyncHandler(dismissDriftHandler));
