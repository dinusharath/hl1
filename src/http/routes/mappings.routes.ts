import { Router, type Request, type Response } from "express";
import { listMappingsHandler, createMappingHandler, deactivateMappingHandler } from "../../mappings/mappings.controller";
import { TARGET_FIELDS, ENUM_VALUES } from "../../domain/forms/schema-meta";
import { asyncHandler } from "../async-handler";
import { requirePermission } from "../auth";

/** Field-mapping management + the schema metadata that constrains the UI's mapping inputs. */
export const mappingsRoutes = Router();

mappingsRoutes.get("/mappings", requirePermission("mappings:read"), asyncHandler(listMappingsHandler));
mappingsRoutes.post("/mappings", requirePermission("mappings:write"), asyncHandler(createMappingHandler));
mappingsRoutes.post("/mappings/:id/deactivate", requirePermission("mappings:write"), asyncHandler(deactivateMappingHandler));

mappingsRoutes.get("/schema", requirePermission("mappings:read"), (_req: Request, res: Response) =>
  res.json({ targetFields: TARGET_FIELDS, enumFields: Object.keys(ENUM_VALUES), enumValues: ENUM_VALUES }));
