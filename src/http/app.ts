import express from "express";
import { cors } from "./middleware/cors";
import { errorHandler } from "./middleware/error-handler";
import { opsRoutes } from "./routes/ops.routes";
import { ingestRoutes } from "./routes/ingest.routes";
import { formsRoutes } from "./routes/forms.routes";
import { mappingsRoutes } from "./routes/mappings.routes";
import { driftRoutes } from "./routes/drift.routes";

/**
 * HTTP app composition. Concerns are separated: request parsing + CORS as middleware, one Router
 * per domain (ops, ingest, forms, mappings, drift), and a terminal error handler. Business logic
 * lives in the controllers/services the routers call, not here.
 *
 * Body size is capped (registration forms are small; cheap DoS guard). Every console route is
 * permission-guarded inside its router (see ./auth); the ingest webhook uses provider-signature
 * auth. Routes are registered before the error handler so thrown/rejected handlers reach it.
 */
const app = express();

app.use(express.json({ limit: "100kb" }));
app.use(cors);

app.use(opsRoutes);
app.use(ingestRoutes);
app.use(formsRoutes);
app.use(mappingsRoutes);
app.use(driftRoutes);

app.use(errorHandler);

export default app;
