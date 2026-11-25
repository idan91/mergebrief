# packages/persistence: agent notes

The persistence layer for the self-host backend. A change that departs from the rules below is argued in the PR.

## Topic docs

Topic docs under `packages/persistence/docs/` bind as firmly as this file. In this file and its topic docs, `docs/dev/`, `docs/self-host/`, `docs/media/`, root files such as `DESIGN.md`, and paths starting `apps/` or `packages/` are the repo root's. Every other path is under `packages/persistence/`, often written without its `src/` prefix or leading folders; `git ls-files packages/persistence | grep <path>` finds it.

Before editing a source file, run `git grep -n <file name without extension> -- packages/persistence/docs` (for an `index.ts`, its folder's name) and read every doc whose hits name your file. Also read any doc whose trigger below names your work:

- **Schema**: changing anything under `schema/` (a column, CHECK, index or vocabulary value): read `docs/schema.md`.
- **Migrations**: writing a migration that drops, renames, tightens, changes a column type, sets NOT NULL, adds a NOT NULL column with no default or deletes rows, or removing or narrowing a vocabulary value: read `docs/migrations.md`.
- **Ingest and queue**: editing `stores/ingest.ts`, `stores/condition-stamps.ts`, `stores/queue.ts` or the condition-stamp writers in `stores/tenant.ts`, or adding a trigger, an approval or a queued job: read `docs/ingest-and-queue.md`.
- **Generation claims and spend**: editing `stores/generation.ts`, `stores/unmet-conditions.ts`, `stores/utc-day.ts`, `schema/generation.ts` or `schema/generation-attempt.ts` (claims, leases, status transitions, the spend ledger): read `docs/generation.md`.
- **Artifacts**: editing `stores/artifact-store/` or `stores/generation-part/`, or any artifact store (marks, hunk spans, narratives, generation parts, chunk layouts): read `docs/artifacts.md`.
- **Review sessions**: editing `stores/review-session.ts` or `stores/carry-over.ts`, or review sessions and carry-over: read `docs/review-sessions.md`.
- **Purge**: editing a sweep (`sweep*` in any store or `auth/` module, `auth/credential-sweep.ts`, `auth/credentials.ts`), retention or credential cleanup: read `docs/purge.md`.
- **Boot**: editing `db/` or `version/`, boot, the migration lock or the instance version: read `docs/boot.md`.
- **Testing**: writing or changing a test or anything under `testing/`, or running the real-Postgres suites: read `docs/testing.md`.

## Map

- `schema/` is one drizzle file per table.
- `src/testing/` is the PGlite cross-package test harness (`exports["./testing"]`, dev-only).
- `auth/` holds the PRE-tenant resolvers (they PRODUCE the tenant) and owns the credential rows (`auth_session`, `api_token`, `github_grant`), plus AES-256-GCM token crypto behind the key-provider interface. `createEnvKeyProvider(env)` takes the env map explicitly; the composition roots that call it read `process.env`.
- `stores/url-box.ts` holds `resolveUrlBoxOwner`, which answers which owner holds a pasted PR.
- `stores/webhook-delivery.ts` is the webhook delivery seen-set, keyed by the SHA-256 of the verified `X-Hub-Signature-256` header; the unsigned delivery id rides beside it for log correlation only.
- `stores/user-settings.ts` is per-user state keyed by GitHub user id, not tenant-scoped on purpose: a person spans installations. One typed column per setting.
- `stores/queue.ts` holds every `graphile_worker.add_job` call this package makes.
- `stores/inbox.ts` holds the ONE multi-scope read, the Inbox list; `test/scope-containment.test.ts` refuses a second store source that spells an installation set (`inArray` over `installationId`, or a raw `in (`).

## Invariants (enforced, don't weaken)

- **Tenancy:** callers reach the database only through this package's factories and free functions. Bound to a scope context: `createTenantRepository`, `createArtifactStore`, `createGenerationPartStore`, `createGenerationProjection`, `createIngestRoutines`, `createPurgeRoutines`, `createInboxArchiveStore`, `createLiveReadStore`. Bound to the handle alone: `createInboxStore`, `createUserSettingsStore`, `createWebhookDeliveryStore`, `createGrantAuth`, `createSessionAuth`, `createTokenAuth`. Free: `writeAudit`, `sweepAuditLog`, `sweepClosedPullRequests`, `sweepExpiredSessions`, `sweepDeadCredentials`, `sweepWebhookDeliveries`, `sweepStaleGenerationParts`, `deleteUserCredentials`, `resolveUrlBoxOwner`, `readSpendBreakdown`. The raw drizzle handle hides behind the opaque `AppDatabase` (module-private in `src/db/handle.ts`); `internal()` is the in-package unwrap and is never re-exported from `index.ts`.
  - Two scope worlds exist (`src/stores/scope.ts`): the installation tenant (`installation_id`) and the url-box owner (`pull_request.owner_user_id`, children marked by a NULL `installation_id`). Exactly one of the two is set on `pull_request`, CHECK-paired with `source`.
  - Every read filters and every write stamps through the resolved `RowScope`. Per-PR child writes verify the parent `pull_request` belongs to the scope inside the same transaction; owner-world child reads add a `pull_request` semi-join for owner isolation. Credential rows hold no installation and never sit behind a scope: they live in `auth/`, keyed by token hash, grant id or reviewer, and the credential sweeps (`sweepExpiredSessions`, `sweepDeadCredentials`) are instance-wide.
  - Every credential transaction locks sessions, then tokens, then grants, and several grants in id order: the browser mint (`mintTokenFromSession`) takes its session `FOR SHARE` first, so a logout either waits for it or refuses it. Within that order, every table's rows lock `FOR UPDATE` in id order wherever one transaction takes several: `deleteSessionsWhere`, `retireGrant`, `deleteUserCredentials` and the sweeps. A new multi-row credential write keeps both orders, or two of them deadlock.
  - Type-level containment tests in `test/tenant.test.ts` and `test/owner-scope.test.ts` guard this. Keep them passing.
  - `matchesWorld` matches every owner's rows in the owner world, so each use relies on a parent check. `test/scope-containment.test.ts` lists every use with the check it relies on, and `test/owner-scope-reads.test.ts` calls each session method with another owner's ids. A new use joins the list; a new `ReviewSessionRepository` method fails typecheck until it has a cross-owner case.
  - Several scopes in one call is for reads and for the Inbox list only: a viewer reaches several installations, and the list is the one read that spans them (an `IN` over installation ids plus the viewer's own url-box branch). Every write keeps one scope; a write stamp is always one installation or one owner.
- **Unscoped reads:** every one is named here, and a new one is argued in its PR. Sweep mechanics live in `docs/purge.md`.
  - `resolveUrlBoxOwner`: an owner id, never a row, never an installation row.
  - The credential reads in `auth/` by token hash, grant id or reviewer (`listForUser` lists a reviewer's token metadata).
  - User settings by GitHub user id.
  - The webhook delivery seen-set by signature digest (`hasRecentDelivery`: it runs before any tenant write, and a signature names no tenant row), with its instance-wide `sweepWebhookDeliveries`.
  - `countStartedRuns` and its free form `readSpendBreakdown`: instance-wide unit sums for the daily cap and the Operator's spend read.
  - `sweepAuditLog` (audit retention), `sweepStaleGenerationParts`, `sweepExpiredSessions`, `sweepDeadCredentials` and `sweepClosedPullRequests` (pull request retention, both scope worlds): all instance-wide.
  - `deleteUserCredentials`: every session, token and grant of one GitHub user, since the revoke webhook names a user, never a tenant.
- **Audit:** append-only, no outbound FKs: no update or delete helpers exist. The only removal is the retention sweep (`docs/purge.md`).
  - A row holds ids, tokens and numbers: never a body, never free text, never an address.
  - Metadata takes OPEN keys and CLOSED values (`src/stores/audit.ts`): a token, a finite number, or a boolean, nothing else. The value rules are the PII enforcement; weakening them is argued in the PR.
  - `operation` and `target_type` are open token vocabularies (the descriptors belong to `apps/api`, whose choke point writes every request-path row), shape-checked in code and by a DB CHECK. Rows this package writes itself (purge sweeps, the mint transaction, the credential wipe) name their own operation token, apart from any descriptor id.
- **Errors:** a call that resolves a parent row outside the caller's scope throws `ScopeViolationError` (`stores/scope.ts`, exported from the root); the api answers 404 and the worker fails the job without retry. Ingest's queue and trigger routines and the generation store's guarded transitions answer a row outside the scope as they answer a missing one instead: nothing queued, `not-found` or `claim-lost`. A marks or hunk-span body that fails its coordinates-only schema throws `InvalidArtifactBodyError` (`stores/artifact-store/index.ts`), a writer defect the worker also fails without retry. An upstream error reaches a message only sanitized: `markFailed` sanitizes any failure `detail` itself via `logging`'s `sanitizeErrorDetail`, so a caller cannot bypass it. A lost compare-and-set is a refusal, not an absence: `swapEntryComment` answers `swap-lost` with the id the row holds, and `not-found` for a row missing or outside the scope.
- **Database clock:** every `generation.updated_at` write stamps `clock_timestamp()`, through `stampWriteTime` (`stores/generation.ts`) on an update and the column default (`schema/generation.ts`) on an insert, never `now()`, the transaction's start, or a process clock.
- **Every `pull_request` update moves `row_version`** (`buildNextRowVersion`): the live read takes a stored GitHub time as its own only while the row is still at the version the read was planned against, so a writer that skips the bump lets a stale read overwrite it. `test/tenant.test.ts` and `test/live-read.test.ts` hold this for each writer.
- **Store calls are spans.** Each factory returns its methods through `traceStore` (`stores/trace-store.ts`, over `logging`'s `traceMethods`), named for the store (`reviewSessions`, `briefs`), so a trace groups a call's queries under `<store>.<method>`; a `ScopeViolationError` is the caller's answer and leaves the span unfailed. A new factory does the same.

## Migrations

- `drizzle-kit generate` only, never `push` (the `graphile_worker` schema is owned by graphile-worker and must not be managed by drizzle; `drizzle.config.ts` scopes to `public`). Generated SQL under `drizzle/` is append-only; the pre-release squash into `0000_baseline` was a one-off, not a precedent.
- Journal `when` values strictly increase (`check:migrations`, `scripts/journal-order.ts`): drizzle applies only entries above the ledger's newest, so a lower one is skipped for good on a database already past it. Each entry's `idx` is its position, counting from 0, held by the same check.
- **Expand and contract, every release, majors included.** Release N-1 keeps working beside release N: a schema change that drops, renames or tightens splits into an Expand step in one release and a Contract step in the next release of any kind, patch included. A release that must break the rule is a Breaking release and its notes say so. The same promise covers the graphile job payload (`GenerateJobPayload`: add one release, remove the next) and the HTTP contract (`packages/contract`, additive within a major). `pnpm check:migrations` (inside `pnpm lint`, `scripts/check-contracts.ts`) requires a `-- contracts <release>` first line on a migration that drops, renames, changes a column type, sets NOT NULL, adds a NOT NULL column with no default or deletes rows; recipes and the exact gate scope are in `docs/migrations.md`.
- **Every CHECK is declared in its table file** with drizzle's `check()`; `test/schema-checks.test.ts` fails when the schema's CHECKs differ from the migrated ones. **Adding a value is a map change plus a generated migration**, in lockstep (`docs/schema.md`).

## Naming

- One scoped exception to verb-first names: Drizzle column-DSL helpers (`tenantColumns()`) stay noun-named, matching Drizzle's own `bigint()`/`text()` register.
- DB identifiers stay snake_case (Postgres convention); TS property names camelCase, drizzle row types included.

## Verification

`pnpm -C packages/persistence test` runs PGlite against the checked-in migrations. Real-Postgres suites and the migration smoke: `docs/testing.md`.
