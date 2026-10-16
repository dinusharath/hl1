/** OpenAPI 3.1 description of the ingestion API. Served at /openapi.json and rendered at /docs. */
export const openApiSpec = {
  openapi: "3.1.0",
  info: {
    title: "Healthtech Ingestion API",
    version: "1.0.0",
    description:
      "Resilient ingestion of registration forms. Ingest is durable and idempotent; forms are " +
      "transformed, geocoded, and delivered via a transactional outbox. Responses are PII-free.",
  },
  servers: [{ url: "http://localhost:3000", description: "Local" }],
  tags: [
    { name: "Ingestion", description: "Submit and inspect forms" },
    { name: "Ops", description: "Liveness / readiness" },
  ],
  paths: {
    "/ingest": {
      post: {
        tags: ["Ingestion"],
        summary: "Submit a registration form",
        description:
          "Durably stores the raw payload and returns immediately. Idempotent on `session_id`: a " +
          "duplicate is counted (not reprocessed); the same id with different data is quarantined " +
          "for review. Returns 202 only after a durable commit; 5xx tells the provider to resend.",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/IngestedForm" },
              examples: {
                person_one: {
                  summary: "Happy path",
                  value: {
                    session_id: "c8267b77-d796-451e-9948-e82f56412b56",
                    application_reference: "GRU-123089-2026",
                    name: "John Doe",
                    email: "john.doe@example.com",
                    gender: "male",
                    date_of_birth: "1990-01-01",
                    phone_number: "07123456789",
                    mobile_number: "07123456789",
                    address: {
                      address_line_1: "Stratford Village Surgery",
                      address_line_2: "50C Romford Road",
                      address_line_3: "London",
                      postcode: "E15 4BZ",
                      country: "United Kingdom",
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "202": {
            description: "Accepted and stored for background processing",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    id: { type: "string", format: "uuid" },
                    outcome: { type: "string", enum: ["accepted", "duplicate", "conflict"] },
                    status: { $ref: "#/components/schemas/FormStatus" },
                  },
                },
              },
            },
          },
          "400": { description: "Body is not a JSON object" },
          "413": { description: "Body exceeds the size limit" },
          "503": { description: "Could not durably store — safe to resend" },
        },
      },
    },
    "/forms": {
      get: {
        tags: ["Ingestion"],
        summary: "List forms (redacted)",
        parameters: [
          {
            name: "status",
            in: "query",
            required: false,
            schema: { $ref: "#/components/schemas/FormStatus" },
            description: "Filter by lifecycle status (e.g. NEEDS_REVIEW, FAILED).",
          },
        ],
        responses: {
          "200": {
            description: "Up to 100 forms, newest first. No personal data.",
            content: {
              "application/json": {
                schema: { type: "array", items: { $ref: "#/components/schemas/FormSummary" } },
              },
            },
          },
        },
      },
    },
    "/forms/{id}": {
      get: {
        tags: ["Ingestion"],
        summary: "Inspect one form (redacted trace)",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
        responses: {
          "200": {
            description: "Status, soft flags, retry count, and delivery state. No personal data.",
            content: { "application/json": { schema: { $ref: "#/components/schemas/FormDetail" } } },
          },
          "404": { description: "No such form" },
        },
      },
    },
    "/stats": {
      get: {
        tags: ["Console"],
        summary: "Counts by status (for the dashboard)",
        responses: { "200": { description: "Totals and per-status counts (PII-free)" } },
      },
    },
    "/forms/{id}/replay": {
      post: {
        tags: ["Console"],
        summary: "Replay a dead-lettered form",
        description: "Re-drive a NEEDS_REVIEW or FAILED form (reset to PENDING). Idempotent pipeline makes this safe.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "{ ok: boolean }" }, "404": { description: "Not found or not in a replayable state" } },
      },
    },
    "/replay": {
      post: {
        tags: ["Console"],
        summary: "Bulk replay all forms in a parked status",
        requestBody: { content: { "application/json": { schema: { type: "object", properties: { status: { type: "string", enum: ["NEEDS_REVIEW", "FAILED"] } } } } } },
        responses: { "200": { description: "{ count, status }" } },
      },
    },
    "/forms/{id}/conflicts": {
      get: {
        tags: ["Console"],
        summary: "List pending payload conflicts for a form",
        description: "A session_id resent with different data never overwrites the original form — the conflicting payload is retained here, unredacted, for an operator to inspect and resolve.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Array of { id, payload, receivedAt, resolution, resolvedAt }" } },
      },
    },
    "/forms/{id}/conflicts/{conflictId}/apply": {
      post: {
        tags: ["Console"],
        summary: "Accept a conflicting payload as the correction",
        description: "Overwrites the form's stored payload with the conflict's and re-enters the pipeline (status PENDING, attempts reset).",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "conflictId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "{ ok: true }" }, "404": { description: "No such pending conflict on this form" } },
      },
    },
    "/forms/{id}/conflicts/{conflictId}/dismiss": {
      post: {
        tags: ["Console"],
        summary: "Reject a conflicting payload",
        description: "The original form is left exactly as it was.",
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "conflictId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "{ ok: true }" }, "404": { description: "No such pending conflict on this form" } },
      },
    },
    "/forms/{id}/payload": {
      get: {
        tags: ["Console"],
        summary: "The form's raw fields, for hand-mapping a stuck form",
        description: "Unredacted — the one surface where raw provider data is exposed, to an authorized operator fixing a NEEDS_REVIEW form with no confident suggestion.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "{ rawPayload }" }, "404": { description: "No such form" } },
      },
    },
    "/forms/{id}/manual-map": {
      post: {
        tags: ["Console"],
        summary: "Apply a hand-drawn mapping to a stuck form",
        description: "One or more source fields -> one target field each (alias or composite). `save:true` persists it as a reusable mapping (future forms auto-fix); `save:false` applies it to this form only.",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["rules"],
                properties: {
                  save: { type: "boolean", default: false },
                  rules: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["kind", "sourcePath"],
                      properties: {
                        kind: { type: "string", enum: ["alias", "enum", "format", "route", "composite"] },
                        sourcePath: { type: "string" },
                        targetPath: { type: "string", nullable: true },
                        valueMap: { type: "object", additionalProperties: { type: "string" } },
                        fallback: { type: "array", items: { type: "string" }, description: "composite: the remaining source fields, in order" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { "200": { description: "{ ok: true, mappingIds? }" }, "404": { description: "No such form" } },
      },
    },
    "/mappings": {
      get: {
        tags: ["Console"],
        summary: "List field mappings",
        parameters: [{ name: "includeInactive", in: "query", required: false, schema: { type: "boolean" } }],
        responses: { "200": { description: "Active (and optionally historical) mappings" } },
      },
      post: {
        tags: ["Console"],
        summary: "Create (version) a mapping — applied at runtime, no deploy",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["kind", "sourcePath"],
                properties: {
                  kind: { type: "string", enum: ["alias", "enum", "format", "route"] },
                  sourcePath: { type: "string" },
                  targetPath: { type: "string", nullable: true },
                  valueMap: { type: "object", additionalProperties: { type: "string" }, nullable: true },
                  fallback: { type: "array", items: { type: "string" } },
                  scope: { type: "string", enum: ["all", "future"] },
                },
              },
            },
          },
        },
        responses: { "201": { description: "The created, active mapping version" }, "400": { description: "Invalid body" }, "409": { description: "Concurrent create for the same slot — retry" } },
      },
    },
    "/mappings/{id}/deactivate": {
      post: {
        tags: ["Console"],
        summary: "Deactivate (roll back) a mapping",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "{ ok: true }" }, "404": { description: "Not found or already inactive" } },
      },
    },
    "/drift": {
      get: {
        tags: ["Console"],
        summary: "Open schema-drift observations (with suggestions + confidence)",
        parameters: [{ name: "status", in: "query", required: false, schema: { type: "string" } }],
        responses: { "200": { description: "Actionable observations; redacted shapes, computed suggestion + confidence" } },
      },
    },
    "/drift/{id}/approve": {
      post: {
        tags: ["Console"],
        summary: "Approve a drift suggestion → create mapping + replay affected forms",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "{ ok, mappingId, replayed }" }, "404": { description: "No such observation" }, "422": { description: "No actionable suggestion" } },
      },
    },
    "/drift/{id}/dismiss": {
      post: {
        tags: ["Console"],
        summary: "Dismiss a drift observation",
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "{ ok }" }, "404": { description: "Not found" } },
      },
    },
    "/schema": {
      get: {
        tags: ["Console"],
        summary: "Valid mapping targets (for constrained UI inputs)",
        responses: { "200": { description: "{ targetFields, enumFields, enumValues }" } },
      },
    },
    "/health": {
      get: { tags: ["Ops"], summary: "Liveness", responses: { "200": { description: "Process is up" } } },
    },
    "/ready": {
      get: { tags: ["Ops"], summary: "Readiness (checks the database)", responses: { "200": { description: "Ready" }, "503": { description: "Database unreachable" } } },
    },
  },
  components: {
    schemas: {
      FormStatus: {
        type: "string",
        enum: ["PENDING", "PROCESSING", "TRANSFORMED", "GEOCODED", "DISPATCHED", "DONE", "NEEDS_REVIEW", "FAILED"],
      },
      Address: {
        type: "object",
        required: ["address_line_1", "address_line_2", "postcode", "country"],
        properties: {
          address_line_1: { type: "string" },
          address_line_2: { type: "string" },
          address_line_3: { type: "string" },
          postcode: { type: "string" },
          country: { type: "string" },
        },
      },
      IngestedForm: {
        type: "object",
        description: "The agreed incoming schema. Unknown/renamed fields are tolerated, not rejected.",
        required: ["name", "email", "gender", "date_of_birth", "mobile_number", "address"],
        properties: {
          session_id: { type: "string", description: "Idempotency key (per-submission)." },
          application_reference: { type: "string" },
          name: { type: "string" },
          email: { type: "string", format: "email" },
          gender: { type: "string", examples: ["male", "female", "other"] },
          date_of_birth: { type: "string", examples: ["1990-01-01"] },
          phone_number: { type: "string" },
          mobile_number: { type: "string" },
          address: { $ref: "#/components/schemas/Address" },
        },
      },
      Flag: {
        type: "object",
        properties: { code: { type: "string" }, detail: { type: "string" } },
        description: "A PII-free soft warning (e.g. lossy_name_split, coerced_gender).",
      },
      OutboxEntry: {
        type: "object",
        properties: {
          type: { type: "string", enum: ["FORMBOT", "EMAIL"] },
          status: { type: "string", enum: ["PENDING", "SENDING", "DELIVERED", "FAILED"] },
        },
      },
      FormSummary: {
        type: "object",
        properties: {
          id: { type: "string", format: "uuid" },
          applicationReference: { type: "string", nullable: true },
          sessionId: { type: "string", nullable: true },
          status: { $ref: "#/components/schemas/FormStatus" },
          statusMessage: { type: "string" },
          attempts: { type: "integer" },
          duplicateCount: { type: "integer" },
          flagsCount: { type: "integer" },
          outbox: { type: "array", items: { $ref: "#/components/schemas/OutboxEntry" } },
          receivedAt: { type: "string", format: "date-time" },
        },
      },
      FormDetail: {
        allOf: [
          { $ref: "#/components/schemas/FormSummary" },
          {
            type: "object",
            properties: {
              flags: { type: "array", items: { $ref: "#/components/schemas/Flag" } },
              lastError: { type: "string", nullable: true },
              transformed: {
                type: "object",
                properties: { exists: { type: "boolean" }, geocoded: { type: "boolean" } },
              },
              pendingConflicts: { type: "integer", description: "Unresolved same-session, different-payload conflicts awaiting operator action" },
            },
          },
        ],
      },
    },
  },
} as const;
