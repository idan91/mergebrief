# Test databases

- A test file shares one PGlite instance (`registerSharedPglite` in `test/helpers.ts`, reset before each test by `resetPgliteHarness` on `persistence/testing`); a test that alters the schema or replaces `add_job` takes its own, and a statement log (`createQueryLog`) rides the shared one.
- The real-Postgres suites read `MERGEBRIEF_TEST_POSTGRES_URL` (`readTestPostgresUrl` on `persistence/testing`, which the api's `refresh-postgres.test.ts` and the worker's real-graphile test read too), never `DATABASE_URL`: unset, they skip locally and fail under `CI`.
- Run them against a throwaway container, never the development database: `docker run --rm -d -p 55433:5432 -e POSTGRES_PASSWORD=throwaway postgres:17-alpine`, then `MERGEBRIEF_TEST_POSTGRES_URL=postgres://postgres:throwaway@127.0.0.1:55433/postgres pnpm -C packages/persistence test`.
- Optional real-Postgres migration smoke: `docker compose up -d postgres`, then `DATABASE_URL=postgres://mergebrief:mergebrief@127.0.0.1:5432/mergebrief pnpm -C packages/persistence migrate`.
