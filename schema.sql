-- Healthtech-1 — resilient form ingestion · canonical schema.
--
-- This mirrors exactly what `prisma migrate` generates from prisma/schema.prisma (verified with
-- `prisma migrate diff`): TEXT ids (UUIDs — app-side via Prisma @default(uuid()), or DB-side via
-- gen_random_uuid()::text on the raw ingest insert), native PG enum types, snake_case
-- columns, TIMESTAMP(3) for timestamps, DATE for date_of_birth. The ONE thing Prisma can't express
-- — the partial unique index enforcing a single active mapping per slot — is appended at the end
-- and must be added as a manual step in the migration.

-- ---- Enums ----
CREATE TYPE "FormStatus"   AS ENUM ('PENDING','PROCESSING','TRANSFORMED','GEOCODED','DISPATCHED','DONE','NEEDS_REVIEW','FAILED');
CREATE TYPE "OutboxType"   AS ENUM ('FORMBOT','EMAIL');
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING','SENDING','DELIVERED','FAILED');

-- ---- Core pipeline ----

-- Durable inbox. Raw payload lands here first; dedupe + observability live here.
CREATE TABLE "ingested_forms" (
    "id"                    TEXT NOT NULL,
    "session_id"            TEXT,                                   -- idempotency key (or hash: fallback)
    "application_reference" TEXT,
    "raw_payload"           JSONB NOT NULL,                         -- stored untouched — never lose data
    "payload_hash"          TEXT NOT NULL,                          -- disambiguates same-id/different-data
    "status"                "FormStatus" NOT NULL DEFAULT 'PENDING',
    "flags"                 JSONB NOT NULL DEFAULT '[]',            -- soft, non-blocking warnings (PII-free)
    "attempts"              INTEGER NOT NULL DEFAULT 0,             -- bumped once per claim
    "last_error"            TEXT,
    "claimed_at"            TIMESTAMP(3),                           -- worker lease
    "next_attempt_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duplicate_count"       INTEGER NOT NULL DEFAULT 0,             -- observed provider redeliveries
    "last_seen_at"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at"            TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ingested_forms_pkey" PRIMARY KEY ("id")
);

-- Transformed output — exactly one per ingested form (upsert → transform is idempotent).
CREATE TABLE "transformed_forms" (
    "id"               TEXT NOT NULL,
    "ingested_form_id" TEXT NOT NULL,
    "first_name"       TEXT NOT NULL,
    "last_name"        TEXT NOT NULL,
    "email"            TEXT NOT NULL,
    "gender"           TEXT NOT NULL,                               -- male | female | prefer-not-to-say
    "date_of_birth"    DATE NOT NULL,                               -- date-only, no timezone
    "phone_number"     TEXT,
    "mobile_number"    TEXT NOT NULL,
    "address_line_1"   TEXT NOT NULL,
    "address_line_2"   TEXT NOT NULL,
    "address_line_3"   TEXT,
    "postcode"         TEXT NOT NULL,
    "country"          TEXT NOT NULL,
    "longitude"        DOUBLE PRECISION,                            -- nullable until geocoded
    "latitude"         DOUBLE PRECISION,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "transformed_forms_pkey" PRIMARY KEY ("id")
);

-- Transactional outbox. One row per (form, destination) → one work item.
CREATE TABLE "outbox" (
    "id"               TEXT NOT NULL,
    "ingested_form_id" TEXT NOT NULL,
    "type"             "OutboxType" NOT NULL,
    "idempotency_key"  TEXT NOT NULL,                               -- receiver dedupes → one effect
    "status"           "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts"         INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error"       TEXT,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- A session_id resent with DIFFERENT data. The original ingested_forms row is never overwritten
-- or reopened (preserves whatever it already decided — DONE stays DONE) — but the conflicting
-- payload is never dropped either: it lands here, unredacted, for an operator to apply (overwrite
-- the original + reprocess) or dismiss. ON DELETE RESTRICT — a conflict must outlive the form it
-- disagrees with; it is the evidence of what the provider actually sent.
CREATE TABLE "form_conflicts" (
    "id"               TEXT NOT NULL,
    "ingested_form_id" TEXT NOT NULL,
    "payload"          JSONB NOT NULL,          -- the conflicting payload, stored untouched
    "payload_hash"     TEXT NOT NULL,
    "received_at"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution"       TEXT,                    -- NULL (pending) | applied | dismissed
    "resolved_at"      TIMESTAMP(3),
    CONSTRAINT "form_conflicts_pkey" PRIMARY KEY ("id")
);

-- ---- Self-healing schema drift (§10) ----

-- One row per ISSUE (not per form). Feeds the on-call drift console.
CREATE TABLE "drift_observations" (
    "id"              TEXT NOT NULL,
    "type"            TEXT NOT NULL,          -- unknown_field | missing_field | likely_rename | ...
    "field_path"      TEXT NOT NULL,
    "observed_shape"  JSONB,                  -- REDACTED shape/exemplar — never raw PII
    "expected"        TEXT,
    "sample_form_ids" TEXT[],
    "count"           BIGINT NOT NULL DEFAULT 1,
    "first_seen"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status"          TEXT NOT NULL DEFAULT 'new',  -- new | suggested | approved | applied | dismissed
    "suggestion"      JSONB,
    "confidence"      DECIMAL(4,3),
    "source_engine"   TEXT,                   -- rule | llm
    CONSTRAINT "drift_observations_pkey" PRIMARY KEY ("id")
);

-- Mappings applied by the agent/auto-apply. Append-only + version + active → reversible & audited.
CREATE TABLE "field_mappings" (
    "id"             TEXT NOT NULL,
    "kind"           TEXT NOT NULL,           -- alias | enum | format | route | composite
                                               --   composite: source_path + fallback[] are the
                                               --   N sources, joined into target_path (N→1 merge,
                                               --   e.g. firstName + lastName -> name)
    "source_path"    TEXT NOT NULL,
    "target_path"    TEXT,
    "value_map"      JSONB,
    "fallback"       JSONB NOT NULL DEFAULT '[]',
    "priority"       INTEGER NOT NULL DEFAULT 100,
    "scope"          TEXT NOT NULL DEFAULT 'all',  -- all | future
    "version"        INTEGER NOT NULL,
    "active"         BOOLEAN NOT NULL DEFAULT true,
    "confidence"     DECIMAL(4,3),
    "source_engine"  TEXT,                    -- rule | llm | manual
    "observation_id" TEXT,
    "approved_by"    TEXT NOT NULL,           -- audit: 'auto' or a user
    "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at" TIMESTAMP(3),
    CONSTRAINT "field_mappings_pkey" PRIMARY KEY ("id")
);

-- ---- Indexes ----
CREATE UNIQUE INDEX "ingested_forms_session_id_key"        ON "ingested_forms"("session_id");
CREATE INDEX        "ingested_claimable"                   ON "ingested_forms"("status", "next_attempt_at");
CREATE UNIQUE INDEX "transformed_forms_ingested_form_id_key" ON "transformed_forms"("ingested_form_id");
CREATE INDEX        "outbox_dispatchable"                  ON "outbox"("status", "next_attempt_at");
CREATE UNIQUE INDEX "outbox_ingested_form_id_type_key"     ON "outbox"("ingested_form_id", "type");
CREATE UNIQUE INDEX "drift_observations_type_field_path_key" ON "drift_observations"("type", "field_path");
CREATE INDEX        "conflict_pending"                       ON "form_conflicts"("ingested_form_id", "resolution");

-- ---- Foreign keys ----
ALTER TABLE "transformed_forms" ADD CONSTRAINT "transformed_forms_ingested_form_id_fkey"
    FOREIGN KEY ("ingested_form_id") REFERENCES "ingested_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_ingested_form_id_fkey"
    FOREIGN KEY ("ingested_form_id") REFERENCES "ingested_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "form_conflicts" ADD CONSTRAINT "form_conflicts_ingested_form_id_fkey"
    FOREIGN KEY ("ingested_form_id") REFERENCES "ingested_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_observation_id_fkey"
    FOREIGN KEY ("observation_id") REFERENCES "drift_observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---- Manual step (Prisma can't express a partial unique index) ----
-- Enforce at most ONE active mapping per (kind, source_path, target_path). Append this to the
-- generated migration SQL after `prisma migrate dev`.
CREATE UNIQUE INDEX "uq_active_mapping"
    ON "field_mappings" ("kind", "source_path", COALESCE("target_path", ''))
    WHERE "active";
