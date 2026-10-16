import { Router } from "express";
import {
  getFormHandler, listFormsHandler, statsHandler,
  listConflictsHandler, applyConflictHandler, dismissConflictHandler,
  getFormPayloadHandler, manualMapHandler,
} from "../forms.controller";
import { replayFormHandler, replayAllHandler } from "../../worker/replay.controller";
import { asyncHandler } from "../async-handler";
import { requirePermission } from "../auth";

/** Forms, dashboard stats, dead-letter replay, and same-session payload conflicts. */
export const formsRoutes = Router();

formsRoutes.get("/stats", requirePermission("forms:read"), asyncHandler(statsHandler));
formsRoutes.get("/forms", requirePermission("forms:read"), asyncHandler(listFormsHandler));
formsRoutes.get("/forms/:id", requirePermission("forms:read"), asyncHandler(getFormHandler));
formsRoutes.post("/forms/:id/replay", requirePermission("forms:replay"), asyncHandler(replayFormHandler));
formsRoutes.post("/replay", requirePermission("forms:replay"), asyncHandler(replayAllHandler));

// A session_id re-sent with different data never overwrites the original; the conflicting payload
// is retained here so an operator can inspect both versions and apply the correct one by hand.
formsRoutes.get("/forms/:id/conflicts", requirePermission("forms:read"), asyncHandler(listConflictsHandler));
formsRoutes.post("/forms/:id/conflicts/:conflictId/apply", requirePermission("forms:replay"), asyncHandler(applyConflictHandler));
formsRoutes.post("/forms/:id/conflicts/:conflictId/dismiss", requirePermission("forms:replay"), asyncHandler(dismissConflictHandler));

// Manual-mapping path for a stuck NEEDS_REVIEW form with no (or no confident) suggestion.
formsRoutes.get("/forms/:id/payload", requirePermission("forms:read"), asyncHandler(getFormPayloadHandler));
formsRoutes.post("/forms/:id/manual-map", requirePermission("forms:replay"), asyncHandler(manualMapHandler));
