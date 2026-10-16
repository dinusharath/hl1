-- CreateEnum
CREATE TYPE "FormStatus" AS ENUM ('PENDING', 'PROCESSING', 'TRANSFORMED', 'GEOCODED', 'DISPATCHED', 'DONE', 'NEEDS_REVIEW', 'FAILED');

-- CreateEnum
CREATE TYPE "OutboxType" AS ENUM ('FORMBOT', 'EMAIL');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'SENDING', 'DELIVERED', 'FAILED');

-- CreateTable
CREATE TABLE "ingested_forms" (
    "id" TEXT NOT NULL,
    "session_id" TEXT,
    "application_reference" TEXT,
    "raw_payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "status" "FormStatus" NOT NULL DEFAULT 'PENDING',
    "flags" JSONB NOT NULL DEFAULT '[]',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "claimed_at" TIMESTAMP(3),
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duplicate_count" INTEGER NOT NULL DEFAULT 0,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ingested_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transformed_forms" (
    "id" TEXT NOT NULL,
    "ingested_form_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "gender" TEXT NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "phone_number" TEXT,
    "mobile_number" TEXT NOT NULL,
    "address_line_1" TEXT NOT NULL,
    "address_line_2" TEXT NOT NULL,
    "address_line_3" TEXT,
    "postcode" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "longitude" DOUBLE PRECISION,
    "latitude" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transformed_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "id" TEXT NOT NULL,
    "ingested_form_id" TEXT NOT NULL,
    "type" "OutboxType" NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drift_observations" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "field_path" TEXT NOT NULL,
    "observed_shape" JSONB,
    "expected" TEXT,
    "sample_form_ids" TEXT[],
    "count" BIGINT NOT NULL DEFAULT 1,
    "first_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL DEFAULT 'new',
    "suggestion" JSONB,
    "confidence" DECIMAL(4,3),
    "source_engine" TEXT,

    CONSTRAINT "drift_observations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "field_mappings" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "source_path" TEXT NOT NULL,
    "target_path" TEXT,
    "value_map" JSONB,
    "fallback" JSONB NOT NULL DEFAULT '[]',
    "priority" INTEGER NOT NULL DEFAULT 100,
    "scope" TEXT NOT NULL DEFAULT 'all',
    "version" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "confidence" DECIMAL(4,3),
    "source_engine" TEXT,
    "observation_id" TEXT,
    "approved_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deactivated_at" TIMESTAMP(3),

    CONSTRAINT "field_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "replay_jobs" (
    "id" TEXT NOT NULL,
    "observation_id" TEXT,
    "filter" JSONB NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'all',
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "replay_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ingested_forms_session_id_key" ON "ingested_forms"("session_id");

-- CreateIndex
CREATE INDEX "ingested_claimable" ON "ingested_forms"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "transformed_forms_ingested_form_id_key" ON "transformed_forms"("ingested_form_id");

-- CreateIndex
CREATE INDEX "outbox_dispatchable" ON "outbox"("status", "next_attempt_at");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_ingested_form_id_type_key" ON "outbox"("ingested_form_id", "type");

-- CreateIndex
CREATE UNIQUE INDEX "drift_observations_type_field_path_key" ON "drift_observations"("type", "field_path");

-- AddForeignKey
ALTER TABLE "transformed_forms" ADD CONSTRAINT "transformed_forms_ingested_form_id_fkey" FOREIGN KEY ("ingested_form_id") REFERENCES "ingested_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_ingested_form_id_fkey" FOREIGN KEY ("ingested_form_id") REFERENCES "ingested_forms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_observation_id_fkey" FOREIGN KEY ("observation_id") REFERENCES "drift_observations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Only one ACTIVE mapping per slot (partial index; not expressible in schema.prisma).
CREATE UNIQUE INDEX IF NOT EXISTS "uq_active_mapping" ON "field_mappings" ("kind", "source_path", coalesce("target_path", '')) WHERE "active";
