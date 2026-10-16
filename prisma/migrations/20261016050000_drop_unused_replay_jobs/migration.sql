-- replay_jobs was never written to or read by any code path (replay is a direct status reset in
-- src/worker/replay.ts, not a queued job) — dead table from an earlier design, removed.
DROP TABLE "replay_jobs";
