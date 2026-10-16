# Resilient healthcare form ingestion

## What this is

This service takes patient registration forms from an outside provider, cleans them up, and
passes them on for downstream processing. It is built so that no form is ever lost and no form is
ever processed twice, even when the provider misbehaves (sends the same form again, changes field
names without warning, or goes briefly offline). It recovers from almost everything on its own and
only asks a human to step in when there is a genuine ambiguity it cannot safely decide — and when
that happens, the decision is made in the Drift Console, not in code.

## Run it locally

Do these in order. Each step says what it does and what you should see.

1. **Install dependencies** — downloads the libraries the project needs.
   ```bash
   npm install
   ```

2. **Start the database** — launches a local Postgres in Docker.
   ```bash
   npm run db:up
   ```
   If you already run Postgres on port `5432`, start it on a different host port and point the app
   at it:
   ```bash
   DB_PORT=55432 npm run db:up
   ```
   Then set `DATABASE_URL` in your `.env` to use port `55432` instead of `5432`.

3. **Create your environment file** — copies the example settings you can edit.
   ```bash
   cp .env.example .env
   ```
   The app checks these values at startup and refuses to boot if anything required is missing.

4. **Set up the database tables** — creates the tables the app expects.
   ```bash
   npx prisma migrate dev
   ```

5. **Start the app** — runs the web server and the background worker together.
   ```bash
   npm run dev
   ```
   You should see two log lines:
   - `HTTP listening on :3000` — the web server is up.
   - `worker started` — the background worker is processing forms.

## Try it

With the app running, send a sample form in and then look it up.

1. Submit a form (POST `/ingest`):
   ```bash
   curl -s -X POST http://localhost:3000/ingest \
     -H "Content-Type: application/json" \
     --data @src/forms/examples/person_one.json
   ```
   You get back `202 Accepted` with an `id`, for example:
   ```json
   { "id": "…", "outcome": "accepted", "status": "PENDING" }
   ```
   `202` means "stored safely, we'll process it in the background." Send the exact same form again
   and you get `202` again — it is recognised as a duplicate and not processed twice.

2. Look the form up (GET `/forms/:id`) using the `id` from step 1:
   ```bash
   curl -s http://localhost:3000/forms/<id>
   ```
   This shows the form's current `status`, any soft flags, retry count, the state of each
   delivery, and `pendingConflicts` (see below). In plain terms the status tells you where the
   form is:
   - **PENDING / PROCESSING** — accepted, being worked on.
   - **TRANSFORMED / GEOCODED / DISPATCHED** — moving through cleanup, address lookup, and sending.
   - **DONE** — fully processed and delivered.
   - **NEEDS_REVIEW** — a human needs to make a data decision (handled in the operator console).
   - **FAILED** — our bug stopped it; an engineer fixes the code, then it is replayed.

3. If a form reaches `NEEDS_REVIEW` with **no confident suggestion** (two field names too
   dissimilar to score), it is not a dead end — an operator maps it by hand:
   ```bash
   curl -s http://localhost:3000/forms/<id>/payload              # see the form's actual fields
   curl -s -X POST http://localhost:3000/forms/<id>/manual-map \
     -H "Content-Type: application/json" \
     --data '{"save": false, "rules": [{"kind": "alias", "sourcePath": "<field>", "targetPath": "name"}]}'
   ```
   `save: true` persists the rule for future forms (same effect as the Mappings tab); `save: false`
   fixes only this one form. Either way it re-enters the pipeline immediately.

4. If a `session_id` is resent with **different data**, the original is never silently overwritten
   or reopened — the new payload is retained and surfaced as `pendingConflicts` on the original
   form. `GET /forms/<id>/conflicts` shows both versions; `POST .../conflicts/<conflictId>/apply`
   accepts the new one as the correction (reprocesses with it), `.../dismiss` rejects it (original
   untouched).

## API docs

Interactive reference (OpenAPI 3.1, rendered with [Scalar](https://github.com/scalar/scalar)):

- **http://localhost:3000/docs** — modern API reference.
- **http://localhost:3000/openapi.json** — the raw OpenAPI 3.1 spec.

## Operator UI (separate project)

The backend is API-only. A full operator console — dashboard, submit a form, inspect any form,
schema-drift review and approve, mapping management, hand-mapping a stuck form, and resolving
payload conflicts — lives in its **own repo** — `../healthtech-ingestion-ui` (Vite + React +
TypeScript) — and talks to this API over HTTP only (every action it can take is a plain endpoint
listed in `/docs`); CORS is enabled for it. Run it separately with `npm install && npm run dev`. It
is a client of the API, not part of the service — anything it does, `curl` can also do (see "Try it").

## Security & scope (take-home)

Being explicit about what is real vs. stubbed, since this handles health-adjacent data:

- **Authorization is wired but mocked.** Every console route carries an RBAC permission guard
  (`src/http/auth.ts`, e.g. `mappings:write`, `drift:write`). The *structure* (named permissions,
  401/403 semantics, a single swap-in point) is real; the *identity backend* is a placeholder —
  `resolvePrincipal` trusts an `x-role` header instead of verifying a session/JWT/API key.
  Enforcement is off by default (`AUTH_ENFORCE=true` turns the checks on). The `/ingest` webhook has
  a matching `verifyProvider` placeholder for HMAC signature verification. **With more time:** real
  identity verification + per-tenant RBAC; nothing else about the guards changes.
- **CORS is permissive (`*`)** so the local UI (different port) can call the API. A real deployment
  would restrict the origin.
- **PII/PHI:** responses, logs, flags, and `last_error` are redacted — no name/email/DOB/postcode.
  The only payload-derived values that persist are low-sensitivity enum values (e.g. a gender code
  in a mapping's `valueMap`), which are required for the mapping to function; high-sensitivity PII
  never reaches `drift_observations` or `field_mappings` (there's a test asserting this).
- `/docs` loads the Scalar renderer from a CDN (dev convenience); vendor it for an offline/CSP-strict deploy.

## Tests

- Unit tests (no database needed):
  ```bash
  npm test
  ```
- Full tests including the ones that use a real database (start the database first with
  `npm run db:up`):
  ```bash
  RUN_DB_TESTS=1 npm test
  ```

## Where to look when something's wrong

- **Check a single form** with `GET /forms/:id` (see "Try it"). The `status` tells you what
  happened in plain terms:
  - **DONE** — nothing to do; it worked.
  - **NEEDS_REVIEW** — the provider sent something ambiguous (a renamed field, a new answer we
    don't recognise, a reused id with different data). The form is safely parked, not lost — never
    a dead end: it is waiting on a human decision, always with a way forward (see below).
  - **FAILED** — an unexpected error in our own code. This is an engineering fix, not a data
    decision. Once the code is fixed, the form is replayed.
- **The operator console** (`../healthtech-ingestion-ui`, run separately — see below) is the real,
  working on-call screen, covering every way a form can get stuck:
  - **Review tab** — groups schema-drift mismatches, suggests a fix (rule-based, with a confidence
    score), and **Approve** stores a new versioned mapping and auto-replays the waiting forms — no
    code change, no deploy.
  - **No confident suggestion?** The form's detail view offers **"Map fields by hand"** — pick the
    form's real incoming field(s) and the target field yourself, then choose to save the rule for
    future forms or apply it to just this one.
  - **Reused `session_id` with different data?** The form's detail view shows the competing payload
    directly (never silently dropped) with **"Use this version" / "Keep original"**.
  - Every action here is reversible and audited. `docs/mismatch-console.html` is an earlier static
    mockup of this screen's visual design — the console above is the real, wired implementation.

## Project layout

```
src/
  index.ts            start the web server + worker together
  http/               HTTP endpoints: /ingest, /forms/:id, /health, /ready
  ingest/             the durable "front door" that stores forms and dedupes
  worker/             background loop: claim, transform, geocode, dispatch (crash-safe)
  domain/             transform logic, field mappings, payload hashing
  providers/          geocoder, email, FORM-BOT integrations (with timeouts/retries)
  forms/              schemas + example payloads (src/forms/examples/*.json)
  config/             environment validation (fails fast if misconfigured)
prisma/               database schema + migrations
tests/                unit and database-backed tests
docs/
  ASSIGNMENT.md         the original take-home brief
  design-doc.html       architecture & design write-up
  request-flow.md       end-to-end request + self-healing drift diagrams
  mismatch-console.html the on-call Drift Console mockup
```
