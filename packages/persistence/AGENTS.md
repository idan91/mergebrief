# packages/persistence — agent notes

The persistence layer for the self-host backend (BRIEF-1, P4/M1 workstream 1). Schema and
every design decision live in **`docs/adr/0018-m1-postgres-schema.md` (as amended, D1–D13)**
— do not re-derive or contradict it here; if code must diverge, amend the ADR first. Build
plan: `docs/plans/brief-1-persistence-layer.md`.

## Invariants (enforced, don't weaken)

- **Tenancy (D2b):** `forTenant(db, ctx)` is the only DB surface. The raw drizzle handle is
  hidden behind the opaque `AppDatabase` (module-private symbol in `src/db.ts`); `internal()`
  is the in-package unwrap and must never be re-exported from `lib.ts`. Every read filters
  and every write stamps `installation_id` from ctx; per-PR child writes verify the parent
  `pull_request` belongs to the tenant inside the same transaction. Type-level containment
  tests in `test/tenant.test.ts` guard this — keep them passing.
- **Artifacts (D6):** idempotent `ON CONFLICT (natural key) DO UPDATE` writes; natural keys
  lead with `installation_id`. `comparison_marks` bodies are coordinates-only (strict Zod;
  no `baselineLabel`/`baselineIndex`/line content — D13). `revision_narrative` writes verify
  brief anchoring (D12).
- **Audit (D9):** append-only, numeric-only, no outbound FKs, never purged. Metadata is a
  closed key allowlist (`src/audit.ts`) — that allowlist IS the PII enforcement for an
  un-erasable ledger; widen it only with a matching ADR note.
- **Errors:** expected failures return `Result`, never throw. Error messages must not carry
  key material, tokens, credentials, or unsanitized upstream errors
  (`sanitizeGenerationError` owns generation-error sanitization inside `markFailed`).
- **Migrations:** `drizzle-kit generate` only — never `push` (the `graphile_worker` schema
  is owned by graphile-worker and must not be managed by drizzle; `drizzle.config.ts`
  scopes to `public`). Checked-in SQL under `drizzle/` is append-only.

## Conventions

- **No `enum`:** `as const` maps + `ValueOf<T>`. **Keys SHOUT_CASE, string values
  kebab-case** (`PurgeErrorCode.NOT_FOUND` → `"not-found"`). The doc example in
  `src/types.ts` demonstrates it.
- **Naming grammar:** verb-first for anything that acts or has effects (`loadConfig`,
  `encryptToken`, `resolveKey`); noun factories for pure returns-a-thing constructors in
  builder/DSL position (`tenantColumns()`, `artifactStore()`, `purgeRoutines()`,
  `envKeyProvider()`), matching Drizzle's own `bigint()`/`text()` register.
- Strict TS everywhere: no `any`, no bare `as` (branded ids are constructed via type
  guards), interfaces for shapes, named exports, Zod at boundaries.
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
