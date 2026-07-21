# BRIEF-51 — Observability v1 implementation plan (skeleton)

Status: plan-ready (2026-07-21). All decisions locked in
[ADR 0034](../adr/0034-observability-v1-logging-health.md); discovery on the
BRIEF-51 wayfinder map (Notion, five closed grill tickets — zoom there for
per-decision rationale). Survey: `brief-51-observability-survey.md`.
Per-PR model/effort rows are **proposed — confirm at kickoff** (init-plan
checklist).

## Non-negotiables (from ADR 0034)

- Call sites import ONLY the `packages/logging` seam; pino types never leak.
- Secrets as structured fields, never in `msg`; redact `remove: true`.
- `evt` names exactly as the ADR table; no new first-class names without a
  taxonomy change.
- Health endpoints outside `/api`, unauthenticated, constant JSON.
- No Prometheus / OTel / in-app transports / telemetry-to-us.
- Not a generation-surface change ⇒ NO eval-harness run required.

## PR stack (4 PRs, sequential)

### PR 1 — Foundation: `packages/logging` + root standards file

- New package: `Logger` interface (4 levels + `child`), `createLogger`
  (LOG_LEVEL, NODE_ENV format switch, redact paths, err serializer),
  graphile-worker adapter (`@graphile/logger` logFactory → `child`).
  pino 10 dep; pino-pretty devDep. Package AGENTS.md.
- Root `AGENTS.md` created as canonical (absorbs root CLAUDE.md content +
  the log-level judgment standard); `CLAUDE.md` → symlink to it. Verify
  tooling still picks both up.
- No call-site changes. Unit tests: level filtering, child bindings,
  redaction removal, dev/prod format selection.
- Proposed: Fable session, fable-reviewer gate. LOC small.

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
- Proposed: Fable session, fable-reviewer gate + security-reviewer pass
  (auth-adjacent surface: unauthenticated endpoints, redaction).
- CI path-filter warning: api/web/persistence consumers — run dependent
  suites locally (root CLAUDE.md rule).

### PR 3 — Worker tier adoption

- Inject `new Logger(logFactory)` via the packages/logging adapter in
  worker `main.ts`; replace the 5 `console.error` sites + the injected
  `log` seams (`createGenerator`/`createGenerateTask`) with seam loggers.
- Task-level child bindings `{prId, headSha}`; mint `job.fail`
  (permanent/transient split already in `generate.ts`) and
  `job.retries.exhausted` (`attempt === maxAttempts`); `provider.error`
  `{provider, status}` through the generator log seam.
- Payload contract untouched (coalescing — ADR 0034 #6).
- Proposed: Fable session, fable-reviewer gate.

### PR 4 — Docs

- `docs/self-host/observability.md`: event table (operator render of ADR
  table), health semantics + worker no-HTTP stance, correlation guide,
  Grafana/Loki worked recipe (promtail + LogQL alerts on the alert-worthy
  `evt`s), short Datadog + CloudWatch sections, rotation paragraph.
- `compose.md` link + healthcheck doc line.
- Proposed: Fable session, inline review (docs-only).

## Verification

- Per-PR: package suites + lint (exit codes); PR 2/3 run dependent suites
  locally (path-filter gap).
- End-to-end after PR 3: /verify recipe — trigger a webhook locally,
  confirm one correlated story in stdout (`reqId` → enqueue,
  `prId`+`headSha` across worker logs), force a provider failure for
  `provider.error` + `job.fail`, hit `/healthz` + `/readyz` (up + with
  postgres stopped).
- Grep gate before merge of PR 3: no bare `console.*` left in
  api/worker/web-server (client-side web code exempt).
