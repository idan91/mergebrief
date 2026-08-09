# BRIEF-131 — External Postgres support: DSN hardening, compose story, ops docs

Status: planned 2026-08-03. Spec locked in the 2026-08-03 grill — recorded
as a resolution comment on the board ticket and restated below as binding.
Board ticket: BRIEF-131 (In progress). Builds directly on BRIEF-20's
compose/ops docs (#213/#214).

## Locked spec (grill 2026-08-03 — do not relitigate)

1. **TLS: explicit-or-refuse.** At config load, a non-loopback
   `DATABASE_URL` host with no `sslmode` DSN parameter refuses boot with a
   message telling the operator to choose (`sslmode=verify-full` +
   `sslrootcert`, `require`, or an explicit `disable` for private
   networks). Explicit `sslmode=disable` is allowed. Loopback hosts
   exempt. No new config surface — the DSN carries the decision
   (`pg-connection-string` already parses `sslmode`/`sslrootcert`).
   Document the node-postgres trap: `sslmode=require` does NOT verify
   certificates; real verification is `verify-full` semantics with a CA
   bundle (RDS CA via `sslrootcert=/path`, file-mounted).
2. **Compose: checked-in `docker-compose.external-db.yml`** — web +
   worker only, no postgres service, no `depends_on`; `DATABASE_URL`
   (or `_FILE`) from the environment. Profiles/overrides rejected
   (depends_on on a profiled-out service errors; overrides cannot remove
   services).
3. **Deployment-shapes policy (docs)**: supported = (1) all-in-one
   compose, (2) compose + external Postgres. Further web/worker
   decomposition: "env-configured and stateless outside Postgres — works,
   untested, unsupported" paragraph. K8s/Helm: demand-triggered, out of
   scope.
4. **Migrations vs restricted roles**: `MERGEBRIEF_AUTO_MIGRATE=false`
   switches BOTH services from apply to CHECK — compare checked-in
   migrations against the drizzle ledger read-only; if behind, REFUSE
   boot with the pending count and the manual command
   (`pnpm -C packages/persistence migrate` with a DDL-capable
   `DATABASE_URL`). Default stays auto-migrate. Two-DSN config rejected
   for v1 (revisit trigger: a pipeline that can't run a one-off command).
5. **Secrets: `DATABASE_URL_FILE`** — `_FILE` convention for exactly this
   one variable (official postgres/mysql image precedent). Read file,
   trim trailing newline; takes precedence over `DATABASE_URL` with a
   boot warning naming the shadowed variable. Docs teach the compose
   `secrets:` block and the CA-bundle mount together.
6. **Versions**: floor = PostgreSQL 15+ (bundled image is the
   reference). Verify against ONE real managed provider at
   implementation (see Verification). PGlite-based tests caveat stated
   in docs. Older: may work, unsupported.

## Git requirements (git-eng — mandatory for all git operations)

- Branch `feature/BRIEF-131/external-postgres` off `main`; PR 2's branch
  `feature/BRIEF-131/external-postgres-docs` stacks on it.
- **Chunked commits** — one per logical unit; NO `Co-Authored-By`
  trailers, NO AI attribution in commits or PR bodies.
- **Pre-commit gate: `security-reviewer` AND `performance-reviewer` in
  parallel** on staged changes before EVERY commit; findings with
  confidence ≥80 get fixed and re-reviewed until clean. (Security
  reviewer is not optional here — TLS enforcement, secret-file handling,
  and DSN parsing are the PR's subject matter.)
- Push + PRs only at the PR-ready stage: titles
  `[BRIEF-131] feat: ...`, base `main` (PR 2 retargets after PR 1
  merges), standard Overview/Changelog bodies. Eval-presence gate: no
  generation surfaces should be touched — PR bodies still carry the
  explicit "Eval-harness gate: skipped — no generation-surface files"
  line since reviewers expect it.
- Review loop after push: fable-reviewer per PR (adversarial; PR 1's
  reviewer briefed on TLS-bypass and file-handling attack surface), fix
  medium+, re-review the delta, CI green, then hand to Idan.

## Specialist skills (mandatory)

- `typescript-eng` — Zod config schemas, boot-path logic, persistence
  boundaries.
- `tdd` — **test-first for PR 1's decision matrix**: write the failing
  cases for the TLS gate (loopback/non-loopback × no-sslmode/each-mode),
  `_FILE` precedence (file-only / env-only / both+warning / missing
  file / trailing newline), and the auto-migrate check (current /
  behind / ahead-ledger) BEFORE the implementations.

## Facts verified at planning (re-verify at start)

- Pool construction: `packages/persistence/src/db/handle.ts` +
  `migrate.ts` — `new Pool({ connectionString })`, no explicit `ssl`
  options; `pg-connection-string@2.14.x` in the lockfile parses
  `sslmode`/`sslrootcert` from the DSN.
- Config boundary: `packages/persistence/src/db/config.ts` — Zod, value-free
  error messages (DATABASE_URL never logged; keep it that way).
- Migration mechanism: worker migrates at boot before claiming jobs
  (`runner.ts`), web lazily at first `/api` composition
  (`webhookApp.ts`); `migrateApp` wraps drizzle's node-postgres migrator
  under an advisory lock; ledger table `drizzle.__drizzle_migrations`.
- The drizzle migrator has no public "check only" API — the check reads
  the ledger and compares against `drizzle/meta/_journal.json` entries
  (the BRIEF-114 snapshot key work has prior art for reading the
  journal).

## Work shape — two PRs

### PR 1 — `feature/BRIEF-131/external-postgres` (code, target <600 LOC excl. lockfile)

1. (commit 1, TDD) **DSN resolution module** in persistence `db/`:
   `DATABASE_URL_FILE` precedence (+shadow warning via injected sink),
   trim, missing-file = clear boot error. Tests first.
2. (commit 2, TDD) **TLS gate**: host classification
   (loopback/non-loopback — cover IPv6 `::1`, `localhost`, unix-socket
   DSNs if `pg` accepts them) + sslmode presence check + refusal message
   naming the three choices. Tests first, then wire into config load for
   BOTH services (single boundary preferred — find where both read config).
3. (commit 3, TDD) **Auto-migrate check mode**:
   `MERGEBRIEF_AUTO_MIGRATE` env (default true), check-only ledger
   comparison, refusal with pending count + manual command. Applies to
   worker boot AND web lazy composition. Tests against the PGlite
   harness where the migrator runs there; the pg-specific paths get
   integration coverage via the harness patterns that exist.
4. (commit 4) `.env.example` entries (root + apps/web as appropriate),
   `docs/self-host/compose.md` env-table rows. Code-adjacent docs only —
   the big doc work is PR 2.

### PR 2 — `feature/BRIEF-131/external-postgres-docs` (stacked; compose + docs, target <400 LOC)

1. (commit 1) `docker-compose.external-db.yml` + a `secrets:` block
   example; verified via `docker compose -f ... config`.
2. (commit 2) Docs: `compose.md` external-DB section (DSN examples per
   provider posture, sslmode guidance incl. the require-doesn't-verify
   trap, CA mount, `_FILE` pattern); `operations.md` fork (external DB →
   provider owns backup/restore; auto-migrate=false workflow for
   restricted roles); deployment-shapes policy paragraph; versions
   statement (15+ floor, PGlite caveat).

Run: **Opus 5, single agent, sequential** (PR 2 stacks on PR 1). This
plan is written for a FRESH session — no context beyond this doc, the
ticket, and the repo is assumed.

## Verification

- Per branch: `pnpm -r test`, `pnpm lint`, `pnpm -r typecheck`,
  `pnpm -C apps/web build` — all exit 0. Coverage floors hold.
- `docker compose -f docker-compose.external-db.yml config` clean; the
  default `docker compose config` unchanged vs main.
- **Managed-provider smoke (HITL, before merge)**: Idan runs the
  documented setup against one real provider (Neon/Supabase free tier is
  sufficient): TLS refusal fires without sslmode, connects with
  `verify-full`+CA (or the provider's documented mode), auto-migrate
  applies on first boot, `MERGEBRIEF_AUTO_MIGRATE=false` + a
  behind-schema DB refuses with the right message. The implementing
  session prepares a paste-ready checklist for this and STOPS before
  merge — this step is the ticket's own "verify against at least one
  real managed provider" requirement and cannot be simulated.

## Out of scope

- Two-DSN (migration vs runtime) config; K8s/Helm; `_FILE` for other
  variables; web/worker decomposition support; provider-specific
  automation. All recorded with triggers in the ticket resolution.
