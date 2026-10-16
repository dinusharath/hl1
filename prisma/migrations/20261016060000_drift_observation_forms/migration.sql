-- Replaces array-membership scanning with a real membership table, so `count` is an accurate
-- uncapped tally (not capped by sample_form_ids' display limit) and Approve can replay every
-- affected form, not just a 20-row sample.
CREATE TABLE "drift_observation_forms" (
    "observation_id"   TEXT NOT NULL,
    "ingested_form_id" TEXT NOT NULL,
    "created_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drift_observation_forms_pkey" PRIMARY KEY ("observation_id", "ingested_form_id")
);

ALTER TABLE "drift_observation_forms" ADD CONSTRAINT "drift_observation_forms_observation_id_fkey"
    FOREIGN KEY ("observation_id") REFERENCES "drift_observations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: every observation's EXISTING (capped) samples are at least known members — this
-- preserves count continuity for rows created before this migration (count stays whatever it
-- already was; new occurrences from here on increment it correctly via the join table).
INSERT INTO "drift_observation_forms" ("observation_id", "ingested_form_id")
SELECT "id", unnest("sample_form_ids") FROM "drift_observations"
ON CONFLICT DO NOTHING;
