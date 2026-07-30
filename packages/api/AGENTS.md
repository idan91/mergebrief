# packages/api — agent notes

The Hono HTTP surface for BRIEF-2 (P4/M1 workstream 2). This PR (PR B, stage
4) ships the **webhook trust boundary**: `POST /api/webhooks/github` verifies
the HMAC over the raw body, parses the event through `github`'s Zod boundary,
and maps it — transactionally — to `persistence`'s tenant-scoped writes plus
one debounced graphile `generate` job (`ingestRoutines`). Plan:
`docs/plans/brief-2-github-app.md` (decision #1); grounding ADRs 0016/0020,
0006 + 0018 as amended.

Deliberately NOT here: OAuth login/callback/logout, the authz middleware, and
the read API (PR C); the `apps/web` catch-all mount and the real-Postgres/
graphile composition root (stage 5); any worker/LLM code (BRIEF-3).

## Invariants (enforced, don't weaken)

- **Verify before parse.** The HMAC is checked against the RAW request body
  (the exact bytes GitHub signed) before `JSON.parse`, before Zod, before any
  DB touch. Invalid/missing signature → 401 and NOTHING is written.
- **Tenant from the signed payload.** `TenantContext` derives from the
  payload's `installation.id` (branded by `github`'s parser, revalidated via
  `parseTenantContext`) — never from a spoofable header. All writes go
  through persistence's ctx-bound seams (`forTenant`, `ingestRoutines`,
  `purgeRoutines`); this package never sees a raw DB handle (D2b).
- **Fast 200, no compute.** The webhook handler only upserts rows and
  enqueues one job — no LLM calls, no GitHub API calls, no generation.
  Handled and ignored events alike return 200 quickly.
- **Idempotency is inherent, not bolted on.** Natural-key upserts +
  `job_key = generate:{pull_request_id}` with replace semantics make
  redelivery safe; do not add dedup state here.
- **Deps are injected.** `createApp({ handle, webhookSecret })` — nothing in
  this package reads `process.env` or constructs a database; composition
  roots do.
- **Errors:** expected failures return early with sanitized status bodies
  (401/400); unexpected throws map to a sanitized 500 (internals go to the
  log, never the response). No secrets/tokens in messages or responses.

## Gated-route rules (BRIEF-23 review loop — enforced, don't weaken)

- **One gate per request.** `readsRoute` guards `/api/repos/:repoId/*` with a
  METHOD-AGNOSTIC `app.use`, so any route module mounted after it in
  `app.ts` stacks a second authz gate in front of its own (double GitHub
  access check cold; a transient failure on the second one 404s a
  just-verified request). Mount new route modules BEFORE `readsRoute`, or
  scope their middleware by method+path. The submit tests pin the
  single-gate behavior (`counts.repositories`).
- **Mutations re-resolve the repo fresh.** The gate's cached `repoFullName`
  is ≤60s stale — fine for reads, not for outward writes (a rename +
  name-reuse inside the window would target the wrong repo). A mutating
  route fetches `GET /repositories/{id}` with the viewer token immediately
  before the write. A denial at the fresh re-resolve itself (403/404 BEFORE
  the viewer has re-proven access this request) always collapses to the
  gate's 404 posture — no existence leak, no status distinguishable from a
  cold denial. AFTER a successful re-resolve there is no existence left to
  hide, so the mutation-stage posture is a per-route judgment: where a
  FORBIDDEN carries a real, FE-actionable capability signal it surfaces as
  an honest 403 `github-permission` (mark-ready's App-permission gap,
  resolve-thread's viewer capability); where it carries none it keeps
  collapsing to 404 (the reply POST — any repo reader may reply, so its 403
  is indistinguishable from gone). NOT_FOUND collapses to 404 everywhere.
- **`no-store` on every response of a gated route** — error paths included;
  it is all per-viewer state (`errorJson` in `review-submit.ts`).
- **One refresh-once budget per REQUEST**, shared across every GitHub call
  in the handler (`spendRefresh` closure) — the token can expire between
  calls, and per-call-site refresh logic either misses that or refreshes
  more than once.
- **Deterministic 400s are an FE contract.** Anything a route rejects
  deterministically (caps, shape refines) must be mirrored client-side with
  recoverable copy — the FE resubmits the same state, so an unmirrored
  deterministic 400 is an unrecoverable loop (see `apps/web/AGENTS.md`).
  Corollary: validate that every ACCEPTED payload is representable by its
  own degradation path (the fold-budget refine).

## Conventions

Mirrors `packages/persistence/AGENTS.md`: no `enum` (`as const` +
`ValueOf`, SHOUT_CASE keys / kebab-case values); strict TS, no `any`, no bare
`as` (Zod/guards at boundaries); named exports; extensionless relative
imports (`moduleResolution: "bundler"`); verb-first actions, noun factories.

## Tests

`test/webhook.test.ts` = integration via `app.request()` against
`persistence/testing`'s PGlite harness (real migrations + a `graphile_worker`
stub standing in for the real worker schema — tests only; the stage-5 compose
smoke uses real graphile). Payloads are built inline (shapes cribbed from
`packages/github/test/fixtures/*.json`, not imported) and signed with
`@octokit/webhooks-methods` `sign`. Zero network, zero LLM calls.

## Verification

```sh
pnpm install                  # from repo root, to link workspace packages
pnpm -C packages/api typecheck
pnpm -C packages/api test
pnpm lint                     # repo-root oxlint --type-aware picks this package up
```
