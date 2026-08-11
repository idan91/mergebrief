# packages/persistence — agent notes

The persistence layer for the self-host backend. The schema and every design
decision behind it live in the Postgres-schema decision record under
`docs/adr/` — do not re-derive or contradict them here; if code must diverge,
amend that record first.

## Map

**Entry points: `src/index.ts`** (the public surface, `exports["."]`) and
**`src/testing.ts`** (the PGlite cross-package test harness,
`exports["./testing"]` — dev-only). Every public symbol is re-exported from
`index.ts`, grouped by folder. Start reading there.

```
src/
  index.ts            ENTRY — sectioned re-exports = the public surface
  testing.ts          ENTRY (persistence/testing) — PGlite harness + graphile stub
  types.ts            branded ids + Result/ValueOf re-export (zero-runtime)
  db/                 the opaque handle + its lifecycle
    handle.ts           AppDatabase + createDb/closeDb; internal() unwrap
                        (module-private — the tenancy containment lives here)
    config.ts           Zod env config (DATABASE_URL + minimization knobs)
    migrate.ts          programmatic app-schema migration
  schema/             drizzle table definitions (one file per table)
  stores/             ctx-bound + projection data access
    tenant.ts           forTenant — THE tenant-scoped repository
    artifact-store.ts   the five artifact families
    generation.ts       generation status projection
    ingest.ts           transactional webhook→upsert→enqueue boundary
    purge.ts            purge + retention routines
    audit.ts            append-only audit emit + metadata allowlist
    user-settings.ts    per-user (non-tenant) settings
  auth/               PRE-tenant resolvers (they PRODUCE the tenant) + crypto
    session.ts          reviewer-session resolver
    token.ts            API-token resolver
    crypto.ts           AES-256-GCM token crypto behind the key-provider interface
test/                 per-module suites (PGlite against checked-in migrations)
drizzle/              generated SQL migrations — append-only
```

## Invariants (enforced, don't weaken)

- **Tenancy:** `forTenant(db, ctx)` is the only DB surface. The raw drizzle handle is
  hidden behind the opaque `AppDatabase` (module-private symbol in `src/db/handle.ts`); `internal()`
  is the in-package unwrap and must never be re-exported from `index.ts`. Every read filters
  and every write stamps `installation_id` from ctx; per-PR child writes verify the parent
  `pull_request` belongs to the tenant inside the same transaction. Type-level containment
  tests in `test/tenant.test.ts` guard this — keep them passing.
- **Artifacts:** idempotent `ON CONFLICT (natural key) DO UPDATE` writes; natural keys
  lead with `installation_id`. `comparison_marks` bodies are coordinates-only (strict Zod;
  no `baselineLabel`/`baselineIndex`/line content). `revision_narrative` writes verify
  brief anchoring.
- **Audit:** append-only, numeric-only, no outbound FKs, never purged. Metadata is a
  closed key allowlist (`src/stores/audit.ts`) — that allowlist IS the PII enforcement for an
  un-erasable ledger; widen it only with a matching decision-record note.
- **Errors:** expected failures return `Result`, never throw. Error messages must not carry
  key material, tokens, credentials, or unsanitized upstream errors (`markFailed`
  sanitizes any failure `detail` itself via `logging`'s `sanitizeErrorDetail`).
- **Migrations:** `drizzle-kit generate` only — never `push` (the `graphile_worker` schema
  is owned by graphile-worker and must not be managed by drizzle; `drizzle.config.ts`
  scopes to `public`). Checked-in SQL under `drizzle/` is append-only.

## Conventions

- **No `enum`:** `as const` maps + `ValueOf<T>`. **Keys SHOUT_CASE, string values
  kebab-case** (`PurgeErrorCode.NOT_FOUND` → `"not-found"`). The doc example in
  `src/types.ts` demonstrates it. DB-stored vocabularies (state, kind, status, phase,
  decision, actor_type, action, generation error_code) are also CHECK-constrained
  (migrations 0002 and 0017) — **adding a value needs a code change AND a
  migration**, in lockstep.
- **`GenerationFailureCode` is the widest of those locksteps.** It is the
  DB-stored failure vocabulary (distinct from the store-internal
  `GenerationErrorCode`), so a new code needs FOUR changes together: the
  `as const` map in `src/types.ts`, a CHECK migration, a
  `generationError.<code>` template in `packages/i18n`, and the hand-rolled
  mirror in `apps/web` (`GenerationFailureCodes`). The web mirror parses
  tolerantly — an unknown code renders the generic failed line rather than
  failing the view — so a half-done addition degrades quietly instead of
  breaking loudly. `markFailed` sanitizes any `detail` param itself; callers
  cannot bypass it.
- **Naming grammar:** verb-first for anything that acts or has effects (`loadConfig`,
  `encryptToken`, `resolveKey`); noun factories for pure returns-a-thing constructors in
  builder/DSL position (`tenantColumns()`, `artifactStore()`, `purgeRoutines()`,
  `envKeyProvider()`), matching Drizzle's own `bigint()`/`text()` register.
- Strict TS everywhere: no `any`, no bare `as` (branded ids are constructed via type
  guards), interfaces for shapes, named exports, Zod at boundaries.
- **Extensionless relative imports** (`from "./tenant"`, never `"./tenant.js"`) — this
  package is bundler-resolved end to end (`moduleResolution: "bundler"`; vitest/tsx/
  drizzle-kit). Extensions only where genuinely required (non-TS assets). This is now a
  repo-wide rule (root `CLAUDE.md`).
- DB identifiers stay snake_case (Postgres convention); TS property names camelCase.

## Verification

```sh
pnpm -C packages/persistence typecheck
pnpm -C packages/persistence test       # PGlite against the checked-in migrations
pnpm lint                               # repo-root oxlint --type-aware picks this package up
```

Migration smoke against real Postgres (optional, not CI-gated):

```sh
docker compose up -d postgres
DATABASE_URL=postgres://code_review:code_review@127.0.0.1:5432/code_review \
  pnpm -C packages/persistence migrate
```

## Task board (Notion)
https://app.notion.com/p/Make-Text-Selectable-3935e9400eeb80f7a6aed324f422a18a?source=copy_link#3935e9400eeb80248b23e0f76778c3db