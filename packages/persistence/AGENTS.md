# packages/persistence — agent notes

The persistence layer for the self-host backend. The schema and every design decision behind it live in the Postgres-schema decision record under `docs/adr/`. Do not re-derive or contradict them here; if code must diverge, amend that record first.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

`src/testing.ts` is the PGlite cross-package test harness (`exports["./testing"]`, dev-only).

What the layout can't show:

- `schema/` is one drizzle file per table.
- `stores/ingest.ts` is the transactional webhook→upsert→enqueue boundary.
- `stores/url-box.ts` holds `resolveUrlBoxOwner`, the ONE unscoped read.
- `stores/inbox.ts` holds the ONE multi-scope read, the Inbox list; `test/scope-containment.test.ts` refuses a second store source that spells an installation set (`inArray` over `installationId`, or a raw `in (`).
- `auth/` holds the PRE-tenant resolvers (they PRODUCE the tenant) plus AES-256-GCM token crypto behind the key-provider interface. `createEnvKeyProvider(env)` takes the env map explicitly; the composition roots that call it read `process.env`, this package never does.
- Generated SQL under `drizzle/` is append-only.

## Invariants (enforced, don't weaken)

- **Tenancy:** `createTenantRepository(db, ctx)` is the only DB surface. The raw drizzle handle hides behind the opaque `AppDatabase` (module-private in `src/db/handle.ts`); `internal()` is the in-package unwrap and is never re-exported from `index.ts`.
  - Two scope worlds exist (`src/stores/scope.ts`): the installation tenant (`installation_id`) and the url-box owner (`pull_request.owner_user_id`, children marked by a NULL `installation_id`). Exactly one of the two is set on `pull_request`, CHECK-paired with `source`.
  - Every read filters and every write stamps through the resolved `RowScope`. Per-PR child writes verify the parent `pull_request` belongs to the scope inside the same transaction; owner-world child reads add a `pull_request` semi-join for owner isolation. Credential rows are the exception: `auth_session` and `api_token` hold no installation, so the `sessions` repository and `sweepExpiredSessions` narrow by reviewer in the owner world and by nothing under an installation scope.
  - Type-level containment tests in `test/tenant.test.ts` and `test/owner-scope.test.ts` guard this — keep them passing.
  - ONE unscoped read exists, `resolveUrlBoxOwner` (`src/stores/url-box.ts`): it answers "which owner holds this PR", returns an owner id, never a row, and reaches no installation row. Do not add a second one.
  - Several scopes in one call is for reads and for the Inbox list only: a viewer reaches several installations, and the list is the one read that spans them (an `IN` over installation ids plus the viewer's own url-box branch). Every write keeps one scope; a write stamp is always one installation or one owner.
- **Artifacts:** idempotent `ON CONFLICT (natural key) DO UPDATE` writes; natural keys lead with `installation_id`. `comparison_marks` and `hunk_span` bodies are coordinates-only (strict Zod; no `baselineLabel`/`baselineIndex`/line content), which is why neither is gated on `PERSIST_BASELINE_SNAPSHOT`. `revision_narrative` writes verify brief anchoring.
- **Audit:** append-only, no outbound FKs — no update or delete helpers exist. The only removal is the instance-wide retention sweep in `src/stores/purge.ts` (`sweepAuditLog`), unset by default, refusing any window under the 30-day floor.
  - A row holds ids, tokens and numbers: never a body, never free text. `caller_ip` is the one identifying column, nullable (collecting it is a config change, not a migration), populated only under the operator flag.
  - Metadata takes OPEN keys and CLOSED values (`src/stores/audit.ts`) — a token, a finite number, or a boolean, nothing else. The value rules are the PII enforcement; weakening them needs a matching decision-record note.
  - `operation` and `target_type` are open token vocabularies (the descriptors belong to `apps/api`, whose choke point writes every request-path row), shape-checked in code and by a DB CHECK. Rows this package writes itself (purge sweeps, the mint transaction) name their own operation token, apart from any descriptor id.
- **Carry-over:** evaluated on read — in memory, creating nothing. A read mark carries only against `brief.carried_chunk_ids` (a bare chunk-id match would mark unopened Chunks read); a hop chain that cannot be linked end to end orphans every anchor. Orphaned work is unplaced, never deleted.
  - MATERIALIZED by the first write: one transaction creates the session, copies the carried rows with their verdict columns, and applies the write. It re-reads the previous session's rows rather than trusting the read's payload, and only the session's creator copies — a concurrent first write cannot double the rows.
  - A carried draft keeps its previous row id to the payload, and each copy stores its source row, so one addressing form works on both sides of materialization. A session freezes only once the reviewer materializes a newer one — never because a newer Brief exists.
- **Errors:** expected failures return `Result`, never throw. Error messages must not carry key material, tokens, credentials, or unsanitized upstream errors (`markFailed` sanitizes any failure `detail` itself via `logging`'s `sanitizeErrorDetail`).
- **Migrations:** `drizzle-kit generate` only — never `push` (the `graphile_worker` schema is owned by graphile-worker and must not be managed by drizzle; `drizzle.config.ts` scopes to `public`). Checked-in SQL under `drizzle/` is append-only.

## Conventions

- **DB-stored vocabularies are CHECK-constrained** (state, kind, status, phase, decision, actor_type, generation error_code, audit outcome/classification/channel, review_outcome, draft-comment status/side/anchor_status, reclassification category, disposition carry_status/evidence_status/evidence_kind, api_token scope; migrations 0002, 0017, 0019, 0021, 0024, 0025, 0029). **Adding a value needs a code change AND a migration**, in lockstep — `test/review-session.test.ts` proves it by reading `pg_get_constraintdef` back against the `as const` map.
  - `category` pins against brief-core's `Categories` — a mirror, not a fork, reached ONLY via the `brief-core/remap` subpath, never the barrel (the generation graph and its model SDKs stay out of this package).
  - `WriteClassifications` is the one vocabulary shared outward: it is `api_token.scope` AND the classification `apps/api` sorts every operation by; api re-exports this map rather than declaring a second one. `audit_log.classification` narrows the same map (`read` is never audited) instead of forking it.
- **`GenerationFailureCodes` is the widest of those locksteps.** It is the DB-stored failure vocabulary (distinct from the store-internal `GenerationErrorCodes`), so a new code needs FOUR changes together: the `as const` map in `src/types.ts`, a CHECK migration, a `generationError.<code>` template in `packages/i18n`, and the hand-rolled mirror in `apps/web` (`GenerationFailureCodes`). The web mirror parses tolerantly (an unknown code renders the generic failed line). `markFailed` sanitizes any `detail` param itself; callers cannot bypass it.
- One scoped exception to verb-first names: Drizzle column-DSL helpers (`tenantColumns()`) stay noun-named, matching Drizzle's own `bigint()`/`text()` register.
- DB identifiers stay snake_case (Postgres convention); TS property names camelCase.

## Verification

`pnpm -C packages/persistence test` runs PGlite against the checked-in migrations. Optional real-Postgres migration smoke: `docker compose up -d postgres`, then `DATABASE_URL=postgres://code_review:code_review@127.0.0.1:5432/code_review pnpm -C packages/persistence migrate`.