# 0016: GitHub App, Reviewer Auth, and the Trust/Tenancy Boundary

Status: superseded in part by 0034, 0040, 0042, 0043

One ADR for the product's whole trust surface: the per-instance **GitHub App** (least-privilege scopes + activation), **reviewer authentication** (GitHub OAuth + a repo-access gate on every read), the **tenancy boundary** (instance = trust boundary; rows scoped by `(installation_id, repo)`), **secret handling**, the **all-inputs prompt-injection invariant**, the hosted **"no raw code" posture**, **retention/erasure**, and the **architectural boundaries** that keep SOC2 a later operational program rather than a redesign. Closes epic gating decisions #3 (App scopes) + #4 (secret storage) and the deferred GPT-5.5 review item #6 (trust posture). Sits under the OSS-self-host-first model (ADR 0017, `docs/internal/system-overview.md`).

## Context

The product handles orgs' private source code; the GPT-5.5 review named trust/tenancy the largest gap and "a sales blocker earlier than expected." Distribution is OSS self-host first (ADR 0017): the **adopter is the data controller**, which removes most of our obligations now — but the boundary must be designed so a future hosted, multi-tenant mode is an operational lift, not a re-architecture. Runtime flow is in `docs/internal/system-overview.md` §3.

## Considered Options

- **Activation surface.** Check Run (tidy, but the CTA is a buried "Details" link) · **PR comment (chosen)** — visible CTA, matches CONTEXT.md's Activation; Check Run deferred.
- **Comment lifecycle.** Edit-in-place (no notification, gets buried) · **delete + repost (chosen)** — stays at the bottom and fires a "re-review ready" notification; debounced to one per settled head.
- **Comment permission.** `Issues: write` · **`Pull requests: write` (chosen)** — already required for the reviewer's review, and it also authorizes the PR-conversation comment, so `Issues` is dropped.
- **Persisting code (hosted).** Persist diffs · **fetch on-demand by token (chosen)** — persist only the analysis; baseline snapshot configurable (amended, see Amendments).
- **Secret redaction.** None · broad DLP (rejected — degrades analysis) · **high-confidence patterns, line-preserving (chosen)** (not built, see Amendments).
- **Tenancy.** Instance-only · **scope every row by `(installation_id, repo)` from day one (chosen)** even while single-tenant.

## Decision

1. **Per-instance GitHub App.** Identity (app-id, private key, webhook secret, OAuth client) is all env/config; created by hand per `docs/self-host/github-app.md` (the app-manifest flow is the intended later path, not built); logo uploaded per instance. No hosted-singleton assumption — self-host and hosted differ only in deployment + tenancy density.
2. **Least-privilege scopes** (amended, see Amendments): `Contents: read` (read diffs — never write code), `Pull requests: write`, `Metadata: read`. The PR-conversation comment uses `pull_requests:write` (also needed for the reviewer's review) — **no `Issues` permission**. Events: `pull_request`, `pull_request_review`, `installation`, `installation_repositories`.
3. **Activation = one branded comment, delete + repost per debounced generation** (bottom-of-thread + a "re-review ready" notification; one ping per settled head, never per push). The Brief is read in the web app, **never posted into the PR**. Check Run deferred.
4. **Reviewer auth = GitHub OAuth (user-to-server) + session** (amended, see Amendments). The reviewer's token authors *their own* review at submit; it is short-lived, **field-level envelope-encrypted at rest**, and deleted on expiry/logout.
5. **Authorization gate on every artifact read** (amended, see Amendments) — a single enforced middleware verifies the viewer has GitHub access to the repo (briefs = private source); not per-endpoint. Returns 401 / 403 / 404.
6. **Tenancy = instance is the trust boundary** (no cross-instance data); within an instance **every row is scoped by `(installation_id, repo)`** with a mandatory tenant filter — carried from day one though M1 self-host is single-tenant, so a future hosted multi-tenant mode is not a schema rewrite. (Amended, see Amendments.)
7. **Secrets.** All static secrets (model/BYOK key by env-name per ADR 0013, App private key, webhook secret, OAuth secret) live in env/secret-manager — **never in the DB, never in the repo**. The one dynamic secret (the reviewer token) is envelope-encrypted with a key resolved via a **provider interface** (env now, KMS-droppable later). Generation origin (ADR 0013) is recorded on every artifact.
8. **Prompt-injection invariant — ALL model inputs are untrusted:** PR title/description, the diff/code (including code comments and string literals), review comments, and fetched context. They are **fenced as data, never instructions**; the system prompt (the taxonomy) is the *sole* instruction authority. Containment: the **structured-output floor** (ADR 0013) limits escape into free-form output; **no-verdict + human-in-loop** bound the blast radius (worst case = a misleading-but-valid brief, still human-reviewed, never an auto-gate); rendered output is flagged untrusted to the headless consumer (ADR 0014). Extends ADR 0011/0014 fencing to *all* inputs.
9. **Secret redaction before the model** (not built, see Amendments) — a **line-preserving** pass over the diff redacting **high-confidence credential patterns only** (private keys, recognizable key/token formats); default-on, documented best-effort. Not a general DLP (a redacted credential never changes the brief; broad redaction would degrade analysis).
10. **Hosted "no raw code" posture** — diffs are fetched **on-demand by token** at render (ADR 0006 #9), never persisted (an ephemeral per-session cache is fine; disk/DB is not). Only the **brief (analysis)** and an optional, **configurable baseline snapshot** are stored (amended, see Amendments); with the snapshot off, a delta degrades to a full Brief when the checkpoint commit is GC'd. All model egress flows through the single **Generator port** (ADR 0013) — one auditable confidentiality + sub-processor boundary.
11. **Retention + erasure** — configurable retention window; sweep on PR-close + grace (ADR 0015); **purge by org/installation** (cascading, verifiable) for offboarding + right-to-erasure, with the deletion itself audit-logged.
12. **SOC2 architectural readiness — boundaries now, program later** (amended, see Amendments). Design in: tenant isolation (#6), the single auth/authz gate (#5), the single code→model egress (#10), an **append-only audit log** (one emit per boundary — auth, view, generate, delete, config — immutable, tenant-scoped), the encryption-key provider interface (#7), no-raw-code minimization (#10), and cascade-by-tenant erasure (#11). Processing Integrity is already served by content-addressed idempotent writes (ADR 0006/0008) + origin tracking (0013) + the immutable Receipt (0002). The SOC2 **program** (monitoring, incident response, change management, vendor risk, the audit engagement) is operational and deferred to the hosted offering — on self-host it is the adopter's responsibility.

## Why This Way

Self-host makes the adopter the controller, which removes most obligations now; the discipline is to design the *boundaries* — tenant scope, one auth gate, one egress chokepoint, an audit boundary, key-provider indirection — so the hosted offering is an operational lift rather than a re-architecture. Least-privilege, the no-raw-code posture, and the all-inputs injection invariant directly answer the GPT-5.5 trust gap; and the no-verdict / human-in-loop design that *defines* the product also caps injection blast radius — the honesty stance is a security control.

## Consequences

- The App is never a hosted singleton: every instance carries its own identity/config.
- `installation_id` on every row from day one — minor cost, large future saving (the one true redesign-avoider).
- Net-new but small: an append-only audit table, a central auth middleware, and a key-provider interface. Populating/hardening them is the hosted lift.
- The Generator port (ADR 0013) is now also the confidentiality + sub-processor boundary.
- Builds on ADR 0006 (diffs on-demand, baseline snapshot), 0008 (artifacts/anchoring/retention), 0011/0014 (fencing), 0013 (Generator port, origin, secrets), 0015 (runtime/store, deletion boundary), 0017 (distribution); closes epic gating #3/#4 and GPT-5.5 review #6.

## Amendments

### 2026-07-06: A session binds one user-steerable installation

#4: a session binds exactly ONE installation, but the binding is user-steerable instead of "first accessible": login binds the reviewer's **default installation** (`user_settings.default_installation_id`, ADR 0018 D14) when it is still in their live accessible set (`GET /user/installations`), else the first accessible one; `POST /auth/installation` switches the live session's installation after re-validating the target against that same GitHub-derived set (never a caller-asserted id), audit-logged, with an opt-in `setDefault`. The tenant still derives from GitHub, never from caller input. Superseded by the 2026-09-21 entry.

### 2026-07-06: Three refinements to the authorization gate

#5, one posture. (a) **Positive-only authz cache, 60s TTL**, reintroduced (a 5-min variant was removed 2026-07-05 in favor of recheck-every-read) because the FE's generation-status polling and SSR multi-artifact loads make a GitHub round-trip per read untenable (~720 calls/hr per waiting viewer); keyed `(sessionHash, repoId)`, negatives never cached, so a revoked grant is honored in ≤60s while GitHub's own token enforcement stays live underneath (`apps/api/src/access/consts.ts`). (b) **Cross-repo list endpoint**: a list cannot reuse the per-repo check; its authorized repo set comes from `GET /user/installations/{installation_id}/repositories` with the VIEWER's token (the exact installation∩user-access intersection, numeric ids, rename-proof), cached per session under the same 60s constant; a GitHub failure fails the list, never degrades to a DB-only (leaky) listing. The gate splits into a session-resolution layer (shared) and a repo-authorization layer (per-repo or installation-set), still one enforcement point, two compositions. (c) **SSR is not a second path**: web loaders reach the read API by in-process dispatch of the same Hono app with the viewer's cookie forwarded, so server-rendered reads traverse the identical middleware; SSR'd documents carry `cache-control: no-store` (private HTML must never be proxy-cached). The dispatch mechanism in (c) is superseded by the 2026-10-20 entry on HTTP transport.

### 2026-07-09: API tokens as a second presentation channel

#4: first-class **API tokens** join as a SECOND PRESENTATION CHANNEL over the same session machinery, for the CLI and agents (ADR 0028), not a new auth model. An opaque `mergebrief_...` token (secret-scanner-friendly prefix) is sent as `Authorization: Bearer`; the server stores its SHA-256 hash only, and the hash resolves to a row wrapping the same envelope-encrypted GitHub token + refresh token the session row wraps, then expiry check → tenant ctx → the normal GitHub authz gate, identical code path local and deployed. Miss/expired → 401 with no hint (sessionLayer posture). A token binds exactly ONE installation chosen at mint (superseded by the 2026-09-21 entry); multi-installation is a client-side concern (named CLI profiles). Minting is browser-side only: a cookie-authed settings page (`POST /api/auth/tokens`, `packages/contract/src/operations/index.ts`), token shown once, named + listable + revocable, `last_used_at` tracked; default 90-day expiry, no-expiry allowed (self-host CI is the adopter's call), hard-bounded regardless by the wrapped GitHub refresh token dying ~6 months idle. Auth routes live under `/api/auth/*`; Bearer is accepted on `/api/*` except `/api/auth/*`, which stays browser-only (`apps/api/src/access/session-layer.ts`), so ONE IdP path-exemption rule covers webhooks + CLI traffic forever; no per-IdP integration. Cookie reuse and GitHub-PAT pass-through were rejected (browser-shaped expiry / no installation binding, no MergeBrief-side revocation); no device flow in v1 (revisit: human onboarding friction once peers use it).

### 2026-07-21: Two unauthenticated health probes

#5, per [ADR 0034](0034-observability-v1-logging-health.md): two deliberately UNAUTHENTICATED top-level endpoints exist outside the gate, `/healthz` (static liveness) and `/readyz` (readiness: app composition + `SELECT 1`), answered in the server entry before the Hono app (`apps/api/src/health.ts`), returning constant tiny JSON that leaks no version, dependency, or tenant detail. They are infrastructure probes, not artifact reads; the gate's scope is unchanged. `/api/version` remains an authenticated CLI probe (ADR 0029 #8) and is NOT orchestrator health.

### 2026-07-23: One grant row holds the GitHub credential pair

#4: the copied-pair model is retired. Session and API-token rows no longer each wrap a GitHub credential pair; both reference a first-class **grant** row (`github_grant`, ADR 0018 D15) holding the ONE envelope-encrypted pair per GitHub authorization. Mint links the session's grant instead of copying ciphertext; refresh stays a serialized single-row CAS, re-anchored to the grant row. This makes the divergence (single-use refresh token copied into two rows; whichever channel refreshes first strands the other) unrepresentable by construction. Channel postures are unchanged: cookie refresh-failure still deletes the session; a dead API token keeps 401ing until its owner revokes; a grant is deleted with its last referent, in the same transaction. Rejected for the fix: **own-grant-per-token via device flow** (GitHub docs are silent on whether a second user-to-server authorization coexists with the first; the App manifest cannot enable device flow, so every self-host App needs a manual settings checkbox; the `github_app_authorization` revocation webhook does not identify which grant died and no API lists a user's tokens; research: `docs/internal/dev/github-token-grant-research.md`); device flow stays parked as the onboarding revisit above, not the divergence fix. Also rejected: **copy-plus-cross-patch** (grant-family id + fan-out patching every row sharing a pair), hot-path multi-row choreography where one missed row silently reintroduces the bug. GitHub-side revocation hygiene (inbound `github_app_authorization` handling, outbound per-token DELETE on logout/revoke) is a deliberate follow-up, not this change.

### 2026-08-17: Token scope and the audit boundary under ADR 0040

Per [ADR 0040](0040-review-session-server-store.md), two items. *#4:* an API token carries a **scope** chosen at mint and immutable for its life, `read` / `private-write` / `external-write`, cumulative, the same vocabulary as the Product Operation write classification, enforced inside `productRouter.action()` (a query is `read`, the ladder's bottom rung, so every scope reaches it) and refused with `scope-exceeded` (403) (`packages/contract/src/errors.ts`, `apps/api/src/product-operations/product-router.ts`). A cookie has no row to hold a scope, so the browser stays unlimited: the person is at the keyboard. Existing tokens backfill to full, because read-only would 403 every running CLI on deploy day. The server never learns that an agent is involved; a limit can only ever be a property of a credential, never of a session or a client's claim about itself. *#12:* the audit boundary keeps its emit interface but changes vocabulary and coverage: the descriptor `operation` id replaces the eight-value `action`, coverage is every action plus denials (never a read) from one router choke point, and "never purged" becomes a configurable retention policy whose numeric-only rule now rests on self-host backup grounds (see [ADR 0018](0018-m1-postgres-schema.md) D9 as amended).

### 2026-09-21: No credential binds an installation

Per [ADR 0043](0043-no-credential-holds-a-current-installation.md), #4: a session names its reviewer only, a token binds none at mint, `POST /auth/installation` and `user_settings.default_installation_id` are gone, and every request resolves the installation from its repository against the viewer's live GitHub access. The "exactly ONE installation" sentences in the 2026-07-06 and 2026-07-09 entries are superseded.

### 2026-09-26: Model output renders as text

#8: raw HTML in model output renders as text and is never parsed; `rehype-sanitize` guards only text written on GitHub (comments, the PR description), which the web renderer parses on an explicit opt-in.

### 2026-09-27: Contents is read and write, for one push

#2: `Contents` is read & write. An image a reviewer pastes into a comment is committed on the App's installation token to an orphan `mergebrief/attachments` branch in the pull request's repository, one commit per file, and the comment links the file's GitHub URL so it outlives this instance; the brief serves it back through the gate with the viewer's token. The App still writes no code and touches no other branch. A ruleset on `mergebrief/*` refuses the push and surfaces as `attachments-disabled`; a repository admin deletes the branch from Home on a fresh admin read and a typed confirm, browser session only, audited as `purge-attachments`. Rejected: uploading to GitHub's own `user-attachments` store (no API), and storing images in this instance (the comment on GitHub would then depend on the instance staying up). Self-host doc: `docs/self-host/attachments.md`. The same write permission gates GitHub's `markPullRequestReadyForReview` mutation behind the author's mark-ready affordance (ADR 0031; `docs/self-host/github-app.md`).

### 2026-10-04: Attachment uploads are bounded per reviewer

#2: read access to the repository is enough to attach, and the push is the App's, never the reviewer's, so the instance bounds it: each reviewer may upload a configured number of files and bytes per fixed window (default 10 files or 30 MB per 10 minutes, `MERGEBRIEF_ATTACHMENT_QUOTA_*`), counted in memory per api replica, cookie and Bearer together. Past it the route answers `429 attachment-limit-reached` before any GitHub call.

### 2026-10-19: The App reads organization members

#2: the App gains the organization permission `Members: read`, for one read: listing the teams a reviewer can mention (`@org/team`). GitHub has no mentionable-teams field, and the reviewer's user-to-server token is bounded by the App's permissions, so without it no token here can list teams. The read runs on the reviewer's token, never the installation token, so a reviewer sees only the teams GitHub shows that reviewer, and any cache of them is keyed per reviewer. Its surface is read-only org membership. An installation whose owner has not yet approved the new permission keeps working; team suggestions are empty there. Rejected: typing `@org/team` without suggestions (GitHub still resolves it, but nobody can find a team's slug), and keeping three permissions (adding one after release prompts every installed org).

### 2026-10-20: Web reaches the API over HTTP

#5(c)'s in-process dispatch is superseded by [ADR 0042](0042-workspace-member-kinds.md): web is its own process with no database and no credentials, and its server-side loaders forward the viewer's cookie to the API origin over HTTP (`apps/web/src/server/api/transport.ts`, `apps/web/src/server/api/origin.ts`). The posture holds: every server-rendered read traverses the same gate as a browser read, and SSR'd documents stay `no-store`.

### 2026-10-20: Secret redaction before the model was never built

#9 has no implementation. Nothing in `packages/brief-core/src` or `apps/worker/src` redacts the diff: the only credential stripping is on linked URLs in `packages/brief-core/src/context/providers/url.ts`, and `packages/generators/src/harness/redact.ts` scrubs error messages, not model input. A credential inside a PR diff reaches the model provider today. The decision stands as written and is tracked on the board as a release blocker.

### 2026-10-20: The baseline snapshot is gone; the no-raw-code posture is unconditional

#10's configurable baseline snapshot was never built and migration 0058 removed the table and its gate (ADR 0018 D4 as amended). Every instance runs the snapshot-off posture: nothing code-bearing is stored, and a delta whose checkpoint GitHub can no longer serve falls back to the full Brief.

### 2026-10-20: A second scope world beside the installation tenant

#6's "every row scoped by `installation_id`" has a sibling: a pull request pasted by its owner (the url-box) is anchored on `pull_request.owner_user_id` with a NULL `installation_id`, CHECK-paired with `pull_request.source` (`packages/persistence/src/schema/pull-request.ts`, `columns.ts`). Every read and write resolves one `RowScope` (`packages/persistence/src/stores/scope.ts`). ADR 0047 records the url-box owner world; ADR 0018's Amendments carry the schema.
