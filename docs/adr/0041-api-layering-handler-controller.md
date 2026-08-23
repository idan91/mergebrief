# 0041 — packages/api layering: handler, controller, thrown-error family

Status: accepted (2026-08-23). Decided on BRIEF-202 (wayfinder map: six
decision tickets + closing act). Build plan:
`docs/plans/brief-202-api-layering.md`.

Every Product Operation in `packages/api` (35 ops: 15 queries / 20 actions)
adopts one layering convention: a Hono-free **controller** returning
`Result<T, XxxFailure>`, an HTTP **handler** that parses input, judges
security posture, and throws `ApiError` subclasses, and **persistence's
tenant-scoped stores** as the only repository. `app.onError` becomes the sole
producer of wire error bodies. Every extraction is wire-identical, proven by
the existing full-URL `app.request` suites staying byte-identical and green.

## Context

The package grew route-by-route: fat route files mix parsing, GitHub calls,
domain decisions, posture judgments, and wire mapping (`reads.ts` 869 lines,
`comments.ts` 701). Two styles coexist — most routes call `errorJson`
inline; the Review Session subtree already extracted its machinery
(`write-resolve.ts` et al.) but signals refusals as `{ok:false, response}`,
smuggling HTTP responses through domain code. Six identical `spendRefresh`
closures plus three inline variants copy the token-refresh dance. The
convention converges on the session subtree's shape rather than inventing a
third style — evolved past its response-smuggling.

## Decision

### Three layers

- **Controller**: Hono-free. Returns `Result<T, XxxFailure>` for failures
  the handler must judge; throws for terminal, posture-free failures. No
  `Context`, no `TenantContext` derivation, no HTTP vocabulary.
- **Handler** (HTTP layer): parses/validates input (Zod), calls the
  controller, owns the security-posture judgment, throws `ApiError`
  subclasses; success is a plain Hono `c.json(...)`.
- **Repository**: `packages/persistence` tenant-scoped stores called
  directly — no per-domain repository wrappers (the behavior-wrapper ban),
  never a raw handle.

### Error classes

Abstract base `ApiError(code, params?)` plus exactly one subclass per HTTP
status in `API_ERROR_STATUS`: `BadRequest` 400, `Unauthorized` 401,
`Forbidden` 403, `NotFound` 404, `Conflict` 409, `PayloadTooLarge` 413,
`InternalError` 500, `BadGateway` 502, `ServiceUnavailable` 503. No
speculative classes. Class = HTTP vocabulary; the `ApiErrorCode` product code
rides inside. A `CodeFor<status>` mapped type over `API_ERROR_STATUS`
constrains each class to codes of its status — class, status, and code can
never disagree; `API_ERROR_STATUS` stays the single source of truth.

### `app.onError` is the sole wire-error producer

No route or middleware calls `errorJson` directly — everything throws;
`errorJson` survives only inside `onError` (status map, i18n line,
`no-store`, `apiErrorCode` audit stamp). Non-`ApiError` throws stay
sanitized 500s (internals to the log, never the response). The webhook
route's early exits (invalid HMAC 401, parse 400) convert mechanically to
throws — its trust-boundary internals are otherwise not re-layered — so the
rule holds without exception.

### Throw-vs-return rule (verbatim)

A controller THROWS when the failure is terminal and posture-free (row
genuinely absent, cap hit, human-only op); it RETURNS a Result failure when
the route must judge the posture (anything GitHub-denied, anything whose
status depends on request phase). A controller must never throw
`Forbidden`/`NotFound` for a GitHub denial — that would bypass the route's
uniform-404 collapse and leak existence.

### Posture ownership

The uniform-404 collapse and the honest-403-after-re-resolve judgment live
in the handler; controllers return honest domain failures and stay
security-ignorant. **Middleware is a posture owner too**: when the authz
gate refuses, no handler exists below it, so the gate throws posture-final
errors directly — `NotFound` for the uniform collapse (after
`stampAuditReason`/`stampAuditTarget`, exactly as today), `Forbidden`
(`scope-exceeded`) at the router's scope seam, `Unauthorized` for a missing
principal. The throw-vs-return rule is a controller rule; it does not apply
at the middleware seam.

### Failure vocabulary

Per-op `XxxFailure` unions, discriminant `kind` (kebab-case values),
composing shared members. Shared members wrap lower-layer errors rather than
translating them: `{ kind: "github-denied"; phase: "resolve" | "mutation";
error: GitHubApiError }` — the whole error rides the Result; the handler
maps phase to posture (resolve-denied → uniform-404 collapse,
mutation-denied → the per-route honest-403/404 judgment) — and
`{ kind: "session-rejected"; error: ReviewSessionError }`. Naming contract:
`Failure` = Result-side, `Error` = thrown (CONTEXT.md glossary). Shared
members and the `ApiError` classes live in a shared-errors folder;
op-specific failures colocate with their op and hoist on second use.
Failure→error mapping is inline in the handler by default (switch on
`failure.kind`, throw); extract a named shared mapper only on second use.

### File layout

Uniform folder per catalog domain (even single-op; infra routes conform only
where free). Root is a closed role set: `index.ts` (the `xxxRoute` factory,
mount paths unchanged), `handler.ts`, `controller.ts`, `schemas.ts`,
`utils.ts` (generic only), `consts.ts`, `types.ts`. Domain business logic
lives under `logic/` — never at root, never in `utils.ts`. The controller is
a single exported `xxxController` object; op functions stay module-private,
verb-first, 1:1 with handlers. Per-domain `schemas.ts` is sanctioned — the
repo-wide ban targets cross-owner grab-bags only.

### Controller dependencies

Per-domain `XxxControllerDeps` in the domain's `types.ts` — narrow slices
only, never full `AppDeps`. The handler derives the tenant and passes
`tenant: TenantRepository`; installation-id consumers read
`tenant.ctx.installationId`. Controllers take `log: Logger` (the per-request
child). No `Context` and no repository construction inside controllers.

**`ReviewerGitHubClient`** — the per-request reviewer-identity channel,
counterpart of `InstallationGitHubPort`. Factory
`createReviewerGitHubClient(deps, session, log)` beside
`refreshSessionToken`. Its primitive `run(call, isExpired?)` executes a
token-taking call and, on expiry (default predicate:
`GitHubApiErrorCode.UNAUTHORIZED`), refreshes at most once per request and
re-runs; `session()` exposes the possibly-rotated session. It replaces every
`spendRefresh` closure and inline variant; hand-rolled refresh locals are
banned. The authz gate and allowed-repos resolver adopt it in the authz
conversion.

### Tests and coverage

Two tiers, told apart by whether the file imports `app.request`: full-URL
wire suites stay in `test/` (the byte-identity proof — they never move);
unit tests colocate (`controller.test.ts`, `logic/x.test.ts`). Branch cover
of failure kinds is a review convention, not a threshold. The api lines
floor holds at 75 through every extraction PR (wire-identity is their
proof; floor moves never ride refactor PRs), then ratchets once to 85 after
the last domain PR (measured 91.4% on 2026-08-22). Whole-tree include,
single number, lines-only.

### What the conversion does not touch

- **Audit choreography is unchanged.** `stampAuditTarget`/`stampAuditReason`
  are context-var writes read by the emit middleware after the response;
  `onError` runs inside the middleware chain, so stamps set before a throw
  are visible exactly as before, and `errorJson`-inside-`onError` still
  stamps the wire code as the default denial reason.
- **Streaming**: nothing in the catalog streams (`fetchCompareDiff` buffers
  into `Result<string>`); a future streaming surface must buffer or own its
  error rendering — `onError` cannot rescue a half-written stream.
- Webhook internals (beyond the mechanical throw conversion), worker-side
  persistence access, `ApiError` adoption outside `packages/api`, rate
  limiting.

## Consequences

- A new endpoint cannot hand-roll a wire error: it throws classes or returns
  failures, and the one `onError` seam renders them. Posture mistakes
  concentrate where review looks.
- Controllers become unit-testable without Hono; wire suites keep pinning
  the contract unchanged.
- The `{ok:false, response}` shape dies; session machinery dissolves into
  its domain's controller.
- Every domain conversion must be wire-identical — same status, body,
  headers (`no-store`), GitHub call count/order, DB writes — or it does not
  merge.
