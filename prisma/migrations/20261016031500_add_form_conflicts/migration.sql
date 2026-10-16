CREATE TABLE "form_conflicts" (
    "id" TEXT NOT NULL,
    "ingested_form_id" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "payload_hash" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolution" TEXT,
    "resolved_at" TIMESTAMP(3),

    CONSTRAINT "form_conflicts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "conflict_pending" ON "form_conflicts"("ingested_form_id", "resolution");

ALTER TABLE "form_conflicts" ADD CONSTRAINT "form_conflicts_ingested_form_id_fkey"
    FOREIGN KEY ("ingested_form_id") REFERENCES "ingested_forms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
