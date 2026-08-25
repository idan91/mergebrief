# packages/api — agent notes

The Hono HTTP surface for the self-host backend. Its **webhook trust
boundary** — `POST /api/webhooks/github` — verifies the HMAC over the raw
body, parses the event through `github`'s Zod boundary, and maps it,
transactionally, to `persistence`'s tenant-scoped writes plus one debounced
graphile `generate` job (`createIngestRoutines`).

Deliberately NOT here: the `apps/web` catch-all mount, real-Postgres/graphile
startup wiring, and any worker/LLM code.

## Invariants (enforced, don't weaken)

- **Verify before parse.** The HMAC is checked against the RAW request body
  (the exact bytes GitHub signed) before `JSON.parse`, before Zod, before any
  DB touch. Invalid/missing signature → 401 and NOTHING is written.
- **Tenant from the signed payload.** `TenantContext` derives from the
  payload's `installation.id` (branded by `github`'s parser, revalidated via
  `parseTenantContext`) — never from a spoofable header. All writes go
  through persistence's ctx-bound interfaces (`createTenantRepository`, `createIngestRoutines`,
  `createPurgeRoutines`); this package never sees a raw DB handle.
- **Fast 200, no compute.** The webhook handler only upserts rows and
  enqueues one job — no LLM calls, no GitHub API calls, no generation.
  Handled and ignored events alike return 200 quickly.
- **Idempotency is inherent, not bolted on.** Natural-key upserts +
  `job_key = generate:{pull_request_id}` with replace semantics make
  redelivery safe; do not add dedup state here.
- **Deps are injected.** `createApp({ handle, webhookSecret })` — nothing in
  this package reads `process.env` or constructs a database; composition
  roots do.
- **Errors:** expected failures throw `ApiError` subclasses (sanitized
  401/400 bodies via `onError`); unexpected throws map to a sanitized 500
  (internals go to the log, never the response). No secrets/tokens in
  messages or responses.

## Wire error contract (enforced, don't weaken)

Every expected failure exits as a THROW of an `ApiError` subclass
(`src/shared-errors/`): abstract `ApiError(code, params?)` + exactly one
class per HTTP status (`BadRequest`, `Unauthorized`, `Forbidden`,
`NotFound`, `Conflict`, `PayloadTooLarge`, `InternalError`, `BadGateway`,
`ServiceUnavailable`). `CodeFor<status>` constrains each class to codes of
its status, so class/status/code cannot disagree. `app.onError` is the ONE
producer of `{ error, code, params? }` bodies, the 1:1 code→status map, the
i18n line, and the uniform `no-store` posture (`errorJson` survives only
inside it). Never hand-roll `c.json({ error })`, never call `errorJson`
from a route or middleware. Non-`ApiError` throws render as sanitized 500s.

Layering: controllers are Hono-free and return
`Result<T, XxxFailure>` for anything the handler must judge; they THROW
only terminal, posture-free failures — never `Forbidden`/`NotFound` for a
GitHub denial (that bypasses the uniform-404 collapse). Handlers own
posture and the failure→throw mapping — the domain's
`logic/wire-failures.ts` module (a single trivial switch may stay inline).
Controllers shape `ReviewerGitHubClient.run` refusals with the shared
`buildGitHubDeniedResult` helper (`shared-errors/failures.ts`). Shared failure members wrap
lower-layer errors whole (`github-denied { phase, error }`,
`session-rejected { error }`) — no translating at the boundary. `Failure` =
Result-side, `Error` = thrown (CONTEXT.md glossary).

**Adding a new error code** (the recipe):

1. Add the kebab-case code to `ApiErrorCodes`, its status to
   `API_ERROR_STATUS` (1:1 — a code needing two statuses is two codes), and
   its English template to `API_ERROR_ENGLISH` (i18next `{{param}}` syntax
   for any params, typed in `ApiErrorParams`). The status places the code in
   its class's `CodeFor<status>` automatically — throw it via that class.
2. Add the identical template as `errors.<code>` in
   `packages/i18n/locales/en.json` — the i18n suite pins completeness and
   wording equality against the exported maps. CI's path filter will NOT
   run that suite for an api-only edit: run
   `pnpm -C packages/i18n test` locally.
3. Mirror the code in `apps/web`'s hand-rolled `ApiErrorCode` (its Equals
   pin fails to compile otherwise), and add the matching
   `pulls.briefError.<code>` copy — that lookup is total by a
   template-literal key type, so a missing entry breaks `apps/web`'s
   typecheck. The two catalog blocks are different copy: `errors.<code>` is
   the wire line, `pulls.briefError.<code>` is what a reader sees.
4. A param value must never carry free-form upstream text unless
   pre-sanitized (`sanitizeErrorDetail` from `logging`).

Security collapses stay at the per-domain handlers, BEFORE the wire:
internal enums (`GitHubApiErrorCode`, `UrlBriefErrorKind`,
`RefreshErrorCode`) map to thrown classes there, keeping the uniform-404
posture. A wire code is already the public posture, never the internal
cause.

## Domain layout (enforced, don't weaken)

Every catalog domain is a folder with a closed role set at root — new
endpoints follow it, no exceptions:

- `index.ts` — the `xxxRoute` factory; composition only.
- `handler.ts` — a `createHandlers(deps)` factory, the module's DEFAULT
  export, returning the domain's handlers object (import sites bind it as
  `createXxxHandlers`); members parse/validate (Zod), call the controller, judge posture,
  throw `ApiError` subclasses; success = plain `c.json(...)`. Derives the
  tenant and passes `tenant: TenantRepository` down.
- `controller.ts` — a single `xxxController` object, the module's DEFAULT
  export (the one carve-out from named-exports-only); op functions
  module-private, verb-first, 1:1 with handlers. Hono-free.
- `schemas.ts` / `utils.ts` (generic only) / `consts.ts` / `types.ts`
  (incl. the domain's `XxxControllerDeps` — narrow slices, never `AppDeps`;
  `log: Logger` rides deps).
- `logic/` — domain business logic; never at root, never in `utils.ts`.

No per-domain repository files — persistence's tenant-scoped stores are
called directly. Reviewer-identity GitHub calls go through the per-request
`ReviewerGitHubClient` (`createReviewerGitHubClient`, factory beside
`refreshSessionToken`): its `run(call, isExpired?)` refreshes the token at
most once per request and re-runs; hand-rolled refresh locals are banned.

Tests: full-URL wire suites stay in `test/` (the byte-identity proof); unit
tests colocate (`controller.test.ts`, `logic/x.test.ts`). The tell is
whether the file imports `app.request`.

## Gated-route rules (enforced, don't weaken)

- **One gate per request.** The per-PR subtree (`routes/repos/pr/index.ts`)
  mounts ONE METHOD-AGNOSTIC `use("*", authz)` over everything under
  `/:repoId/pulls/:prNumber`; leaf modules under it must NOT create a gate
  of their own (a second gate means a double GitHub access check cold; a
  transient failure on the second one 404s a just-verified request). A new
  per-PR route mounts inside the subtree and inherits the gate; a per-repo
  surface outside it (the collaborators leaf) carries its own gate
  instance. The submit tests pin the single-gate behavior
  (`counts.repositories`).
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
  thread resolution's viewer capability); where it carries none it keeps
  collapsing to 404 (the reply POST — any repo reader may reply, so its 403
  is indistinguishable from gone). NOT_FOUND collapses to 404 everywhere.
- **Scope is checked at the router seam, not in routes.** Authentication
  stays middleware; `productRouter.action()` composes the scope check in
  front of every action's handlers off the declaration's classification, so
  a route added later is enforced whether or not its author thought about
  it. The ladder `read < private-write < external-write` is cumulative, so
  queries need no check. A credential that does not reach the class gets
  403 `scope-exceeded`; a handler reached with no principal at all fails
  closed with 401. Cookie principals are unlimited by construction — there
  is no row to hold a limit and the person is at the keyboard — while a
  Bearer principal carries `api_token.scope`, chosen at mint and immutable
  for the token's life.
- **The per-PR row world is resolved, not assumed** (`routes/repos/pr/scope.ts`).
  The credential's own world is tried first, so the App door wins for
  rendering; the url-box fallback is INSTANCE-wide — a reader the gate made
  prove GitHub access may open a row another user pasted, and the picked owner
  is deterministic (their own row first, else the oldest). Per-reviewer state
  is unaffected: the Review Session's natural key carries the reviewer.
  Deletion and the personal list stay owner-bound and never use this resolver.
- **`no-store` on every response of a gated route** — error paths included;
  it is all per-viewer state (success responses set it explicitly; every
  error path inherits it from the `renderErrorResponse` producer).
- **The token refreshes at most once per REQUEST**, shared across every
  GitHub call in the handler (`ReviewerGitHubClient.run`) — the token can
  expire between calls, and per-call-site refresh logic either misses that
  or refreshes more than once.
- **Deterministic 400s are an FE contract.** Anything a route rejects
  deterministically (caps, shape refines) must be mirrored client-side with
  recoverable copy — the FE resubmits the same state, so an unmirrored
  deterministic 400 is an unrecoverable loop (see `apps/web/AGENTS.md`).
  Corollary: validate that every ACCEPTED payload is representable by its
  own degradation path (the fold-budget refine).

## Audit (enforced, don't weaken)

**One emit, at the choke point.** `src/product-operations/audit.ts` is
mounted once at the composition root, ahead of the routes, and writes the
audit row for every Product Action and every refusal of one. It sits at the
root rather than inside `action()` because the per-repo gate refuses before
any route handler runs — only a middleware wrapping the gates sees that
denial — and it names the operation from the descriptor the router stamped,
so a route added next year is audited whether or not its author thought
about it. **Never hand-place an emit in a route.**

- **A read is never audited**, denied reads included. Queries fire on every
  render and already produce an `api.access` line.
- **Ids, tokens and numbers only** — no bodies, no free text. A route that
  knows the row it acted on calls `stampAuditTarget`; a route whose wire code
  is a deliberate collapse (the gate's uniform 404) calls `stampAuditReason`
  so the ledger can say `no-repo-access` while the response still says 404.
  Otherwise the denial reason is the wire code, stamped by `errorJson`.
- **HTTP status stays out of the row.** `outcome` plus a reason token is the
  vocabulary; a status would re-introduce the existence leak the collapse
  exists to prevent.
- `client` is matched against this project's own CLI name — never a
  `product/version` SHAPE, which would let a caller write their own address
  into the ledger. Forensic: **nothing may ever branch on it**, and a derived
  value must stay inside persistence's `AuditClientSchema`, since a value the
  store rejects throws inside the emit and loses the whole row.
- `caller_ip` is the socket address, written only under the operator flag.
- **A row is keyed on the acting credential's scope**, never the target's:
  the tenant for an installation-bound credential, or a NULL installation
  with `source: url-box` for an owner-world (installation-less) session. A
  refusal that resolved no credential at all is not recorded. Documented in
  `docs/self-host/operations.md`.

## Product Operation catalog

Every domain route declares its operation through the product router —
declaration and mounting are one statement, so an endpoint cannot exist
without a catalog descriptor. Composing the app IS registering: the root
commit stamps each declaration's full `METHOD /api/...` endpoint into the
registry, and `product-operations.manifest.json` is that registry rendered.

Adding or renaming an operation means regenerating the manifest
(`pnpm -C packages/api manifest`) and committing it — `manifest:check` fails
on drift. The root `dev` and `app:host` scripts run the write path before
starting, so a local run leaves the change in the working tree ready to
commit; `build` only verifies, because a build must never mutate a tracked
source.

The write path composes only when it must: it skips entirely while the
committed manifest is strictly newer than every file under `src/`, `test/`,
`scripts/`, and `package.json` (equal mtimes count as stale), so a normal dev
start pays nothing. `--check` has no such shortcut — it always composes and
judges by bytes, whatever the timestamps say.

The manifest is also one half of a both-directions gate: EVERY operation
needs exactly one entry in `packages/cli/product-operations.map.json` — a
`mergebrief` command, a documented expiring gap, or a reasoned `webOnly` note
— and every entry there must name an operation the manifest carries.

## Conventions

Mirrors `packages/persistence/AGENTS.md`: no `enum` (`as const` +
`ValueOf`, SHOUT_CASE keys / kebab-case values); strict TS, no `any`, no bare
`as` (Zod/guards at boundaries); named exports; extensionless relative
imports (`moduleResolution: "bundler"`); verb-first function names.

## Tests

`test/webhook.test.ts` = integration via `app.request()` against
`persistence/testing`'s PGlite harness (real migrations + a `graphile_worker`
stub standing in for the real worker schema — tests only; the compose smoke
uses real graphile). Payloads are built inline (shapes cribbed from
`packages/github/test/fixtures/*.json`, not imported) and signed with
`@octokit/webhooks-methods` `sign`. Zero network, zero LLM calls.

## Verification

```sh
pnpm install                  # from repo root, to link workspace packages
pnpm -C packages/api typecheck
pnpm -C packages/api test
pnpm -C packages/api manifest:check   # the operation manifest matches the composed app
pnpm lint                     # repo-root oxlint --type-aware picks this package up
```
