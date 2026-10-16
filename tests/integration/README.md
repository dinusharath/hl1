# Integration tests (require Postgres)

These exercise ingest dedupe and the worker pipeline against a real database, so they are
**gated** behind `RUN_DB_TESTS=1` and skipped by default (keeping `npm test` runnable with no
infrastructure).

To run them:

```bash
npm run db:up                      # start Postgres (docker compose)
npx prisma migrate dev --name init # create the schema
RUN_DB_TESTS=1 npm test
```

> Note: at the time these were written the Docker daemon was not available in the build
> environment, so the gated specs below were authored but not executed here. The pure-domain
> suite (which needs no DB) is the authoritative green signal.
