# Plan — BRIEF-1: Persistence Layer (P4/M1 · WS1)

> **Ticket:** BRIEF-1 (Notion board) · **Branch:** `feature/BRIEF-1/persistence-layer` ·
> **Status:** planned, not started.
> Executes workstream 1 of `product-backend-epic.md` against **ADR 0018 as amended
> 2026-07-04** (commit `625aadf`): `activated_at` dropped, `revision_narrative` (D12) and
> `comparison_marks` (D13) added. Every schema decision is already made there — this plan
> sequences the build and fixes the implementation-level choices ADR 0018 left open.
> **Do not re-derive schema decisions here; if the build contradicts ADR 0018, stop and amend
> the ADR first.**

Grounding: ADR 0018 (physical schema, D1–D13) · ADR 0008 (logical model) · ADR 0015 (Postgres
single dependency, Drizzle) · ADR 0016 (tenancy/trust) · `docs/system-overview.md` (target
topology).

## Scope

**In:** a new workspace package that owns everything DB — Drizzle schema for the **11 M1
tables**, migrations, the tenant-scoped repository (`forTenant`), the `ArtifactStore` seam,
the `audit(...)` emit interface, and the `generation` projection write helpers. Plus the
`docker-compose.yml` Postgres service needed to run it locally.

**Out (later tickets):** GitHub App + webhooks (BRIEF-2), worker + graphile-worker wiring +
full compose packaging (BRIEF-3), the auth *flow* (D11's library choice is exercised in
BRIEF-2 — only the `reviewer_session` **table** and the token-encryption helper ship now),
`packages/core` categorizer extraction (BRIEF-3, when the worker needs it), `delta_overlay`
and `disposition` *rows* (M2 — the `disposition` table itself ships now per D7).

## Target layout

```
packages/persistence/          # new workspace package: "persistence"
  drizzle.config.ts            # scoped to the app schema ONLY (never graphile_worker.*)
  drizzle/                     # generated SQL migrations (checked in)
  src/
    schema/                    # Drizzle tables, one file per table + shared column groups
    tenant.ts                  # forTenant(ctx) — the ONLY exported DB surface
    artifact-store.ts          # ArtifactStore seam (D6)
    audit.ts                   # audit(...) emit (D9)
    generation.ts              # status-projection upsert helpers (D10)
    crypto.ts                  # gh-token encrypt/decrypt via key-provider seam (D11)
    types.ts                   # branded ids, Result, ValueOf
  test/
docker-compose.yml             # postgres service (dev + test); worker/web join in BRIEF-3
```

- `pnpm-workspace.yaml` gains `packages/*`. Root scripts gain `-C packages/persistence`
  entries for `typecheck` / `test`; root `lint` (oxlint --type-aware) picks the package up.
- Package mirrors `tools/categorizer` conventions: `"type": "module"`, `private`, exports via
  `./src/lib.ts`, same strict `tsconfig` block (already matches the typescript-eng baseline).

## Tables (fixed by ADR 0018 — build exactly these)

| # | Table | Key decision refs |
|---|---|---|
| 1 | `pull_request` | D5 (aggregate root; **no `activated_at`**; nullable `purge_after` + partial index) |
| 2 | `brief` | D3/D6 (span key `base_sha`+`head_sha`; provenance; inline body) |
| 3 | `delta` | D3/D6 (`baseline_sha` = checkpoint; reviewer-agnostic core) |
| 4 | `diff_snapshot` | D4 (config-gated; the *only* persisted-code table) |
| 5 | `revision_narrative` | **D12** (FK `brief_id` CASCADE; `prev_head_sha` third SHA role; provenance) |
| 6 | `comparison_marks` | **D13** (coordinates-only; no provenance; SHA-pair key) |
| 7 | `checkpoint` | D7 (webhook-driven; unique per reviewer×PR) |
| 8 | `disposition` | D7 (table now, rows M2; content-coordinate anchored) |
| 9 | `generation` | D10 (CQRS projection; `kind` includes `revision-narrative`) |
| 10 | `audit_log` | D9 (append-only; numeric-only; **no outbound FKs**) |
| 11 | `reviewer_session` | D11 (sole secret-bearing table; hash + ciphertext + `key_ref`) |

Raw-SQL-in-migration items (ADR 0018 implementation notes): partial index
`WHERE purge_after IS NOT NULL`; `REVOKE UPDATE/DELETE` on `audit_log` (documented, applied
as the hosted-hardening comment in M1); `ON CONFLICT (natural_key)` upsert paths for artifact
writes and `generation` transitions. Shared Drizzle column groups: `tenant`
(`id` identity + `installation_id`), `stamps` (`created_at` timestamptz), artifact trio
(`body` TEXT + `byte_size` + `created_at`).

## Stages (= commit chunks), with model routing

Each stage is one commit and one dispatchable unit of work. Model/effort routing keeps the
expensive model where ADR-interpretation judgment matters and cheaper models where the spec
is mechanical.

| # | Stage | Model | Effort | Rationale |
|---|---|---|---|---|
| 1 | Package scaffold | Sonnet | low | mechanical; conventions copied from `tools/categorizer` |
| 2 | Schema + first migration | **Fable** | high | the load-bearing stage — encodes every ADR decision; errors ripple |
| 3 | Tenant repository | Opus | high | design-sensitive API surface; invariant crisply specified (D2b) |
| 4 | ArtifactStore + write paths | Opus | medium | subtle `ON CONFLICT` semantics, well-trodden patterns |
| 5 | Purge + retention | Opus | high | deletion correctness; ADR enumerates survivors, tests prove it |
| 6 | Token crypto helper | Opus | medium | standard AES-GCM behind the key seam; security gate is the real check |

1. **Package scaffold** — workspace entry, package.json (incl. `migrate` script →
   `drizzle-kit migrate`), tsconfig, oxlint pickup, vitest config, `docker-compose.yml`
   postgres, drizzle.config scoped to app schema. Empty schema compiles;
   `pnpm -C packages/persistence typecheck` green.
2. **Schema + first migration** — all 11 tables + shared column groups + raw-SQL migration
   items; `drizzle-kit generate` output checked in; migration applies clean to a fresh
   compose Postgres.
3. **Tenant repository** — `forTenant(ctx)`: every query filtered by `installation_id`;
   raw handle not exported (compile-time enforcement — package exports only the repo
   factory); context shape shared by web (authz middleware) and worker (job payload) per
   D2b.
4. **ArtifactStore + write paths** — D6 seam over the typed tables; idempotent
   content-addressed writes (`ON CONFLICT DO UPDATE`); `generation` projection helpers
   (D10 transitions); `audit(...)` emit (D9: generate | delete | config | auth-denial).
   **`comparison_marks` body rule:** persist only `{baselineSha, headSha, files[]}` from the
   CLI's `ComparisonMarks` shape — `baselineLabel` and `baselineIndex` are read-time context
   (the FE knows which compare family it requested; the index resolves from `brief`) and
   MUST NOT enter `body`: the marks content is a pure function of the SHA pair, and the
   checkpoint-equals-prevHead re-review case would otherwise demand two rows the span-only
   unique key forbids.
5. **Purge + retention routines** — PR/repo/installation purge (cascade off `pull_request`
   + explicit `reviewer_session` delete, audit retained per D5/D9); `purge_after` sweep
   query; TTL sweep for sessions.
6. **Token crypto helper** — `crypto.ts`: encrypt/decrypt for `gh_token_ciphertext` behind
   the key-provider seam (env-resolved key by `key_ref`, D11 — direct key, not per-row
   envelope). Table consumers arrive in BRIEF-2.

Each stage ends with: typecheck + vitest + lint green, security-review gate, commit.
Stage handoffs carry no conversational context — each stage's brief is this plan + ADR 0018
(amended) + the D-refs named above, so cheaper-model stages stay on rails.

## Testing

- **Vitest** (repo standard). Schema/repo/store tests run against **PGlite**
  (`@electric-sql/pglite` + Drizzle's PGlite driver) — real Postgres semantics, zero
  docker dependency in CI, fast enough per test file. One **migration smoke test** runs the
  generated SQL against the compose Postgres locally (documented command, not CI-gated in
  this ticket).
- Test the *decisions*: tenant filter actually applied on every repo method (query a second
  `installation_id`, expect empty); purge cascade completeness (insert full graph, purge PR,
  assert only `audit_log` rows survive); artifact write idempotency (same span twice → one
  row); `generation` transition upserts; coordinates-only guard on `comparison_marks`
  (store rejects a payload containing line content — shape-validated by Zod).

## Requirements — TypeScript (from `typescript-eng` + repo rules)

- Strict tsconfig, copied from `tools/categorizer` (already includes
  `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, etc.).
- **No `enum`** — `as const` maps + `ValueOf<T>` (add to `src/types.ts`; e.g. `GenerationStatus`,
  `AuditAction`, `PrState`).
- **No `any`, no bare `as`** — `unknown` + type guards; **Zod at boundaries** (artifact body
  shape checks, job-payload/tenant-context parse) — zod already a workspace dep.
- **Branded types** for the id families D1 makes load-bearing: `InstallationId`, `RepoId`,
  `ReviewerId`, `PullRequestRowId` — prevents the exact `installation_id`/`repo_id` swap
  the tenancy invariant can't afford. Same for `Sha` roles if cheap.
- **Result types** for expected failures (purge target missing, decrypt failure, artifact
  absent); `throw` only for programmer errors.
- `interface` for shapes; named exports only; types co-located, shared ones in `types.ts`.
- Lint = repo convention (**oxlint --type-aware + prettier**, not Biome — repo already
  standardized in PR #18); vitest `expectTypeOf` where the branded-id contracts warrant it.

## Requirements — Git (from `git-eng`, answers locked 2026-07-04)

- **Branch:** `feature/BRIEF-1/persistence-layer` off `main`.
- **Commits:** logical chunks = the six stages above, conventional-commit style matching repo
  history (`feat(persistence): …`, `chore: …` for the scaffold). **Never** `Co-Authored-By`
  or any AI-attribution in commits or PR.
- **Pre-commit gate:** run `security-reviewer` on staged changes before **every** commit;
  findings with confidence ≥ 80 → fix, re-stage, re-run until clean. (Performance review
  skipped — decided.) Relevant hotspots for it: `crypto.ts`, tenant filter, purge routines.
- **PR:** on completion push and open **ready-for-review** against `main`:
  `[BRIEF-1] feat: Persistence Layer` — Overview / Changelog body (repo has no PR template);
  no images section (backend-only).
- Notion: flip BRIEF-1 → In progress at stage 1, → Done on merge.

## Implementation choices fixed by this plan (not in the ADRs)

- **Package name `persistence`** under `packages/*` — matches system-overview's future
  `packages/core` sibling; web/worker consume it via `workspace:*`.
- **Driver: `pg`** (node-postgres) — graphile-worker requires `pg` in BRIEF-3, so one driver
  serves data + queue on one pool; Drizzle's `node-postgres` adapter.
- **PGlite for tests** (rationale above); compose Postgres pinned to a current major
  (postgres:17-alpine) for dev + migration smoke.
- **Migrations via `drizzle-kit generate`** (SQL files, checked in, append-only) — never
  `drizzle-kit push` (implementation note in ADR 0018: push must not manage graphile's
  schema; generated SQL keeps the boundary auditable).
- **Config:** `DATABASE_URL` + `PERSIST_BASELINE_SNAPSHOT` + `STORE_DISPLAY_NAMES` from env
  (Zod-parsed config module); the per-repo YAML loader stays WS6.

## Verification (every stage)

```
pnpm -C packages/persistence typecheck
pnpm -C packages/persistence test
pnpm lint
```

Plus stage 2+: migration applies clean to a fresh compose Postgres
(`docker compose up -d postgres && pnpm -C packages/persistence migrate`).
