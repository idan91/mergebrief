# BRIEF-51 — Observability v1 implementation plan

Status: plan-ready (2026-07-21; init-plan pass same day — skills and commit
strategy user-confirmed). All decisions locked in
[ADR 0034](../adr/0034-observability-v1-logging-health.md); discovery on the
BRIEF-51 wayfinder map (Notion, five closed grill tickets — zoom there for
per-decision rationale). Survey: `brief-51-observability-survey.md`.
Review model: fable-reviewer gate per PR; **Idan reviews all four PRs
together once the stack is complete** — PRs go up ready-for-review and wait.

## Mandatory skills (user-confirmed)

- **git-eng** — invoked explicitly for ALL git operations (branching,
  commits, push, PR creation). Requirements folded in below.
- **typescript-eng** — strict-TS house rules (no `any`, no bare `as`,
  `Result` for expected failures, named exports, extensionless imports).
- **test-driven-development** — tests first for seam, middleware, and task
  logic (vitest).
- **verify** — end-to-end runtime pass after PR 3 (see Testing guide).

## Git workflow (git-eng requirements)

- **Stacked branches**, one per PR:
  `feature/BRIEF-51/logging-package` → `feature/BRIEF-51/web-api-adoption`
  → `feature/BRIEF-51/worker-adoption` → `docs/BRIEF-51/self-host-observability`.
  Each branch is cut from the previous one; PR base = previous branch
  (PR 1 bases on `main`).
- **Commits: chunked** — commit after each logical unit.
- **Pre-commit review gate:** `security-reviewer` on staged changes for
  every PR 2 commit (unauthenticated endpoints + redaction surface);
  findings ≥80 confidence fixed before committing. No performance-reviewer
  (no hot paths). PRs 1/3/4: no per-commit agents.
- **PR titles:** `[BRIEF-51] <prefix>: Title Case` (`feat` for PRs 1–3,
  `docs` for PR 4). No `Co-Authored-By` trailers; no AI-attribution lines
  in commits or PR bodies.
- PRs created ready-for-review (not draft) and left unmerged until Idan's
  end-of-stack review.

## Review loop (per PR, before moving to the next)

1. Suites + lint green (exit codes, not grep — per repo standard).
2. Dispatch **fable-reviewer** on the branch diff; fix findings
   upstream-first (a finding against earlier-PR code is fixed in THAT
   branch, descendants rebased — see Merge guide).
3. Re-run fable-reviewer until clean, then open the PR and proceed.

## Non-negotiables (from ADR 0034)

- Call sites import ONLY the `packages/logging` seam; pino types never leak.
- Secrets as structured fields, never in `msg`; redact `remove: true`.
- `evt` names exactly as the ADR table; no new first-class names without a
  taxonomy change.
- Health endpoints outside `/api`, unauthenticated, constant JSON.
- No Prometheus / OTel / in-app transports / telemetry-to-us.
- Not a generation-surface change ⇒ NO eval-harness run required.

## PR stack

4 PRs, sequential. Estimated LOC each under the 500 ideal; PR 2 is the
largest — diff-stat after each part, split trigger at ~1000.

### PR 1 — Foundation: `packages/logging` + root standards file

- New package: `Logger` interface (4 levels + `child`), `createLogger`
  (LOG_LEVEL, NODE_ENV format switch, redact paths, err serializer),
  graphile-worker adapter (`@graphile/logger` logFactory → `child`).
  pino 10 dep; pino-pretty devDep. Package AGENTS.md.
- Root `AGENTS.md` created as canonical (absorbs root CLAUDE.md content +
  the log-level judgment standard); `CLAUDE.md` → symlink to it. Verify
  tooling still picks both up.
- No call-site changes. Tests (TDD): level filtering, child bindings,
  redaction removal, dev/prod format selection.
- **Model/effort/invocation:** Fable, medium effort, main thread.

### PR 2 — Web/API tier adoption

- Hand-rolled request-logging middleware (~30 lines) + `hono/request-id`
  (accept inbound, echo response header) on the Hono app.
- Event migration: `read` → `api.access` (+ `reqId` field); new
  `webhook.verify.fail` (the silent 401 site), `webhook.dispatch.fail`
  (+ start reading `x-github-delivery`), `audit.fail` (inline-comment +
  conversation audit sites), `token.refresh.fail` (github oauth path).
  Remaining bare `console.*` in api/web-server move to the seam as plain
  leveled logs.
- `/healthz` + `/readyz` in the TanStack server entry; compose web
  healthcheck `/` → `/healthz`; compose `json-file` rotation defaults.
- Breaking-change entries: D9 `read` rename; healthcheck path. D9 contract
  doc updated.
- **Model/effort/invocation:** Fable, high effort, main thread —
  auth-adjacent + the stack's subtlest surface. security-reviewer
  pre-commit gate on every commit.
- CI path-filter warning: api/web/persistence consumers — run dependent
  suites locally (root standards rule).

### PR 3 — Worker tier adoption

- Inject `new Logger(logFactory)` via the packages/logging adapter in
  worker `main.ts`; replace the 5 `console.error` sites + the injected
  `log` seams (`createGenerator`/`createGenerateTask`) with seam loggers.
- Task-level child bindings `{prId, headSha}`; mint `job.fail`
  (permanent/transient split already in `generate.ts`) and
  `job.retries.exhausted` (`attempt === maxAttempts`); `provider.error`
  `{provider, status}` through the generator log seam.
- Payload contract untouched (coalescing — ADR 0034 #6).
- **Model/effort/invocation:** Fable, medium effort, main thread.

### PR 4 — Docs

- `docs/self-host/observability.md`: event table (operator render of ADR
  table), health semantics + worker no-HTTP stance, correlation guide,
  Grafana/Loki worked recipe (promtail + LogQL alerts on the alert-worthy
  `evt`s), short Datadog + CloudWatch sections, rotation paragraph.
- `compose.md` link + healthcheck doc line.
- **Model/effort/invocation:** Fable, low effort, main thread (same
  session; operator-facing prose quality matters more than code
  capability).

## Testing guide

- **Per PR:** package suites + lint judged by exit codes; PRs 2–3
  additionally run dependent packages' suites locally (CI is
  path-filtered — a green CI does not cover consumers).
- **Grep gate (before PR 3 opens):** no bare `console.*` remaining in
  `packages/api`, `packages/worker`, or server-side `apps/web` code
  (client-side web code exempt in v1).
- **End-to-end (after PR 3, /verify skill):**
  1. Stack up; `curl /healthz` (200 static) and `/readyz` (200); stop
     postgres → `/readyz` 503 while `/healthz` stays 200; restart.
  2. Deliver a webhook (or replay via the verify harness): confirm ONE
     correlated story in stdout — `reqId` + `deliveryId` on the webhook
     leg, then `{prId, headSha}` across worker pickup → provider call →
     completion.
  3. Force a provider failure (bad key): `provider.error` then `job.fail`,
     and on final attempt `job.retries.exhausted`; an invalid-signature
     POST emits `webhook.verify.fail` (warn).
  4. Spot-check redaction: no token/secret/connection-string material in
     any line; redacted keys absent entirely (`remove: true`, no
     placeholder).
  5. Dev mode: `NODE_ENV=development` renders pino-pretty; prod renders
     NDJSON.
- Compose healthcheck: `docker compose ps` shows web healthy via
  `/healthz` after the PR 2 change.

## Merge guide (squash-merge stack — the BRIEF-43 gotcha applies)

Idan merges after reviewing the whole stack. Per merge:

1. Squash-merge PR 1 into `main`.
2. `git fetch`, then
   `git rebase --onto origin/main <old-PR1-branch> feature/BRIEF-51/web-api-adoption`
   — a squash-merged parent's commits no longer exist on main, so a plain
   rebase/pull replays or conflicts them. Never plain-pull a just-rebased
   branch; `git push --force-with-lease`, then retarget PR 2's base to
   `main`.
3. Repeat for PR 3 and PR 4 — each merge shifts the next branch with
   `rebase --onto`.
4. After the final merge: full suites on `main`, one more end-to-end pass,
   delete the stack branches.
5. Deploy-visible changes: compose healthcheck path + log format only; no
   callback-URL-type follow-ups.
