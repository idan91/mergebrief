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
    config.ts           Zod env config (DATABASE_URL + minimization/audit knobs)
    migrate.ts          programmatic app-schema migration
  schema/             drizzle table definitions (one file per table)
  stores/             ctx-bound + projection data access
    tenant.ts           forTenant — THE tenant-scoped repository
    artifact-store.ts   the six artifact families
    generation.ts       generation status projection
    ingest.ts           transactional webhook→upsert→enqueue boundary
    review-session.ts   the reviewer's Review Session + its five owned tables
    carry-over.ts       pure carry-over evaluation (hop chain + per-subject verdicts)
    purge.ts            purge + retention routines, incl. the audit sweep
    audit.ts            append-only audit emit + metadata value rules
    user-settings.ts    per-user (non-tenant) settings
  auth/               PRE-tenant resolvers (they PRODUCE the tenant) + crypto
    session.ts          auth-session resolver
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
  lead with `installation_id`. `comparison_marks` and `hunk_span` bodies are coordinates-only
  (strict Zod; no `baselineLabel`/`baselineIndex`/line content), which is why
  neither is gated on `PERSIST_BASELINE_SNAPSHOT`. `revision_narrative` writes verify
  brief anchoring.
- **Audit:** append-only, no outbound FKs — no update or delete helpers exist, and
  the only removal is the instance-wide retention sweep in `src/stores/purge.ts`
  (`sweepAuditLog`), which is unset by default and refuses a window under the
  30-day floor. A row holds ids, tokens and numbers: never a body, never free text.
  `caller_ip` is the one identifying column, nullable so collecting it stays a
  config change and never a migration, and populated only under the operator flag.
  Metadata takes OPEN keys and CLOSED values (`src/stores/audit.ts`) — a token, a
  finite number, or a boolean, nothing else; the value rules are the PII
  enforcement, so weakening them needs a matching decision-record note.
  `operation` and `target_type` are open token vocabularies (the descriptors
  belong to `packages/api`, whose choke point writes every request-path row),
  shape-checked in code and by a DB CHECK. The rows this package writes itself
  — the purge sweeps, the mint transaction — name their own operation token,
  apart from any descriptor id, so neither double-counts the other.
- **Carry-over:** evaluated on read — in memory, creating nothing. A read mark
  carries only against `brief.carried_chunk_ids` (never a bare chunk-id match,
  which would mark a Chunk the reviewer never opened as read), and a hop chain
  that cannot be linked end to end orphans every anchor rather than placing it.
  Orphaned work is unplaced, never deleted. It is MATERIALIZED by the first
  write: one transaction creates the session, copies the carried rows with
  their verdict columns and applies the write. That transaction re-reads the
  previous session's rows rather than trusting the read's payload, and only
  the writer that actually created the session copies, so a concurrent first
  write cannot double the carried rows. A carried draft keeps its previous
  row id all the way to the payload, and each copy stores the row it came
  from, so the one addressing form works on both sides of materialization.
  A session freezes only once the reviewer materializes a newer one — never because a newer Brief exists.
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
  decision, actor_type, generation error_code, audit outcome/classification/channel,
  review_outcome, draft-comment status/side/anchor_status, reclassification
  category, disposition carry_status/evidence_status/evidence_kind, api_token
  scope) are also CHECK-constrained (migrations 0002, 0017, 0019, 0021, 0024,
  0025 and 0029) — **adding a value needs a code change AND a
  migration**, in lockstep. The Review Session vocabularies prove that lockstep in
  `test/review-session.test.ts`, by reading `pg_get_constraintdef` back and comparing
  it to the `as const` map; `category` additionally pins against brief-core's
  `Categories`, which it mirrors rather than forks. The vocabulary stays a
  mirror even though the runtime graph now touches brief-core: the ONLY edge is
  the `brief-core/remap` subpath (the deterministic remapper carry-over
  composes), deliberately not the barrel, so the generation graph and its model
  SDKs stay out of this package. `WriteClassification`
  is the one vocabulary shared outward: it is `api_token.scope` AND the
  classification `packages/api` sorts every operation by, which re-exports this
  map rather than declaring a second one. `audit_log.classification` narrows
  the same map (`read` is never audited) instead of forking it.
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