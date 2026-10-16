# Healthtech-1 — Design & Decisions

A resilient ingestion service for healthcare registration forms from a provider that is explicitly
untrustworthy: it redelivers, drops fields, renames fields, and sends values outside the agreed
vocabulary. The system is built around one idea: **treat the provider as hostile, and make the
database — not application memory — the single source of truth.**

---

## 1. Architecture

Three parts:

1. **A durable inbox.** `POST /ingest` validates loosely, stores the raw payload untouched, and
   returns `202` before any risky work happens. A flaky downstream can never block the provider.
2. **A worker** that moves each form through a state machine entirely in the database: claim →
   transform → geocode → dispatch. Every step is a committed status change, so a crash just
   resumes from the last state — nothing lives only in memory.
3. **A transactional outbox** for the two external effects (FORM-BOT, confirmation email), decoupling
   "we decided to send this" from "the send actually happened."

This is the **transactional outbox pattern** — the standard answer to the dual-write problem (you
cannot atomically commit a database row and an external HTTP call). An event-driven system still
needs an outbox and a relay to avoid losing events on that same dual-write; what's deliberately
varied here is the trigger — a dedicated worker that **polls** rather than a broker that **pushes**.
At this volume polling is simpler, fully recoverable, and introduces no second system to keep
consistent with the database. The worker already runs as its own process (`npm run worker`), so
moving it behind a broker later is a deploy change, not a redesign.

---

## 2. Key design decisions

### Idempotency key — how do we know it's "the same" form?
The idempotency key is `session_id` — the per-submission id the provider is expected to replay on
redelivery. `UNIQUE(session_id)` at the database level, with `ON CONFLICT (session_id) DO UPDATE`
in the same statement as the insert, gives an atomic three-way verdict with no check-then-write race:

| Same `session_id`? | Same `payload_hash`? | Verdict |
|---|---|---|
| No | — | **New** — processed normally |
| Yes | Yes | **True duplicate** — `duplicate_count++`, never reprocessed |
| Yes | No | **Conflict** — the new payload is retained (`form_conflicts`), never silently dropped or silently applied |

If the provider ever stops sending `session_id`, ingestion falls back to `payload_hash` and adds a
soft `missing_session_id` flag — degraded, not rejected.

### Schema-drift tolerance — never reject
A missing optional field, an unrecognized enum value, or a renamed field never causes a `4xx`/`5xx`
reject to the provider. The payload is always stored; the worker decides, after the fact, whether the
form can still be usefully processed (soft flag, `DONE`) or needs a human decision (`NEEDS_REVIEW`).
**Nothing accepted is ever silently dropped.**

### Delivery guarantees — and the honest truth about "exactly-once"
Exactly-once delivery to an external system is not something a local database transaction can
guarantee — that is the dual-write problem. What's actually built: **at-least-once** delivery, a
stable **idempotency key** FORM-BOT dedupes on, marking `DELIVERED` only on a verified ack, and a
**reconciliation sweep** that re-drives anything stuck mid-`SENDING` (a crash between send and
commit). That composes to one *logical* effect — but only because the downstream cooperates on the
key. State this caveat plainly; don't claim more than the architecture provides.

The confirmation email is enqueued on **transform success alone**, independent of FORM-BOT and
independent of geocoding — a bad postcode can never suppress the guaranteed email.

### Error taxonomy — retry vs. fail fast
- **Transient** (5xx, timeout, DB deadlock) → bounded retry with backoff + jitter.
- **Data problem** (ambiguous, unresolvable without a human) → `NEEDS_REVIEW`.
- **Deterministic bug in our own code** → `FAILED` immediately — never burn the retry budget on
  something retrying will never fix.

### Concurrency & worker safety
Claiming uses `FOR UPDATE SKIP LOCKED` plus a `claimed_at` lease — multiple worker processes can run
concurrently against the same table with zero coordination and never double-claim a row. A worker
that dies mid-flight has its row reclaimed once the lease expires on a later tick; a form that keeps
crashing its worker hits an attempts cap and is dead-lettered to `NEEDS_REVIEW`, not retried forever.
Every forward status write is a compare-and-set (`WHERE id AND status = <expected>`), so a concurrent
actor that already moved the row to a terminal state can't be silently overwritten.

### Soft flag vs. hard quarantine
Degraded-but-usable outcomes (a coerced gender value, a lossy name split, a missing `session_id`)
get a `flags` note and keep flowing to `DONE` — auditable, not blocking. Only a genuinely unresolvable
field blocks in `NEEDS_REVIEW`. This keeps the review queue small and high-signal instead of noisy.

---

## 3. Database schema

```
ingested_forms       durable inbox: session_id (UNIQUE), payload_hash, raw_payload JSONB,
                      status, flags, attempts, claimed_at (lease), duplicate_count
transformed_forms    cleaned output: name/gender/DOB parsed, address flattened, lat/long —
                      UNIQUE(ingested_form_id) so the transform upsert is idempotent
outbox                one row per (form, destination): UNIQUE(ingested_form_id, type),
                      idempotency_key, independent per-row retry/status
form_conflicts        a session_id resent with DIFFERENT data — the original row is never
                      overwritten or reopened; the new payload is retained here for a human
                      to apply or dismiss. Nothing accepted is ever thrown away.
drift_observations    one row per DRIFT PATTERN (not per form) — grouped by (type, field_path),
                      with a computed suggestion + confidence
drift_observation_forms  the true, uncapped membership of which forms hit which observation —
                      the idempotency guard for recording, and what Approve replays in full
field_mappings        append-only + version + active; a partial UNIQUE index enforces exactly
                      one active mapping per (kind, source_path, target_path) slot
```

All timestamps are stored and compared in UTC. `date_of_birth` is a plain `DATE` column — no
timezone conversion can shift it by a day.

---

## 4. Self-healing schema drift

The baseline already never drops a drifted form — this layer turns *recurring* drift into a
reviewable queue instead of a standing incident.

**Observe.** Every drift signal is recorded against an aggregated `drift_observations` row grouped
by `(type, field_path)` — ten thousand forms hitting the same pattern collapse into one issue, not
ten thousand review items.

**Suggest.** A deterministic, rule-based engine (no LLM) proposes a mapping with a computed
confidence: field-name similarity (bigram Dice + token overlap) crossed with value-shape evidence for
renames; known synonyms or nearest-value for enums; format detection for dates. When two or more
unknown fields both resemble the same **free-text** target (no validated shape) — a provider that
split `name` into `firstName`/`lastName` — the engine suggests a **composite** (merge) instead of a
lossy 1→1 rename that would silently drop the second field. A composite never auto-applies: whether
split fields should be joined or are alternatives can't be settled from names alone, so it always
needs a human's approval (two curated built-ins — `firstName`+`lastName` and the snake_case
equivalent — are the one exception, auto-resolving with no review at all).

**Review & apply.** Approving writes a new versioned `field_mappings` row (append-only, reversible —
rollback is deactivate + re-replay) and replays every affected form via the uncapped membership
table, not a display sample. Above a confidence threshold, a mapping can auto-apply without a human
at all, so on-call is never paged for routine, well-scored drift.

**The hand-mapping escape hatch.** Not every drift is scoreable — two sufficiently dissimilar field
names produce no suggestion at all. Rather than a dead end, an operator can view the stuck form's
actual incoming fields and draw the mapping themselves, choosing to persist it as a reusable rule
(future forms auto-fix) or apply it to just this one form.

**Guardrails.** No PII in drift observations — redacted shapes/exemplars only. The one deliberate
exception is the hand-mapping and conflict-resolution views, where an authorized operator
reconciling a *specific* stuck form needs to see its real fields. Replay is idempotent throughout.

**Roadmap, stated honestly.** An LLM (Claude) fallback for the genuinely ambiguous cases the rule
engine scores too low to act on — the one piece of this design that remains unbuilt.

---

## 5. Edge cases this is built to survive

| # | Scenario | Behavior |
|---|---|---|
| 1 | Same form redelivered | `202` both times; second is not reprocessed |
| 2 | Same id, different payload | Conflict captured, original preserved, never silently resolved |
| 3 | Provider drops a required field | `NEEDS_REVIEW`, not a reject |
| 4 | Provider sends an unrecognized enum value | Soft-mapped if a rule/mapping exists, else `NEEDS_REVIEW` |
| 5 | Oversized / malformed body | Terminal `4xx` — never looped as if retryable |
| 6 | Downstream 5xx / timeout | Backoff retry, capped, then `NEEDS_REVIEW` |
| 7 | A form that crashes its worker every time | Attempts cap → `NEEDS_REVIEW`, loop survives |
| 8 | Two workers running concurrently | `SKIP LOCKED` — no double-processing |
| 9 | Worker crashes mid-form | Lease expires, another tick reclaims and resumes from last committed state |
| 10 | A drift pattern affecting 10,000+ forms | One review card; approving replays all of them, not a capped sample |

---

## 6. Testing strategy

Unit tests cover the pure transform/mapping/suggestion logic in isolation. Integration tests run
against a real Postgres instance and cover the scenarios that only show up under real concurrency
and real constraints: duplicate submission → one row, one FORM-BOT send; two workers over one
backlog → each form processed exactly once; a crash mid-pipeline → reclaimed and completed without
a double-send; a deterministic bug → zero wasted retries; the drift-observation idempotency and
uncapped-count guarantees under concurrent recording.
