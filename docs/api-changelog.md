# API changelog

Consumer-visible changes to the public HTTP surfaces — `/api/*`, including
the browser-managed `/api/auth/*` management routes — keyed to the
**server version** (`GET /api/version`; surfaced by
`mergebrief auth status`). Entries name the version that shipped them —
NOT a git SHA: releases are what adopters deploy, and the version string is
what a skewed client can actually see. (Within this monorepo, pre-release
"versions" are the `SERVER_VERSION` the operator sets; `dev` means an
untagged build — key such entries to the merge date instead.)

The contract discipline (ADR 0029): response shapes change additively
within a major; removals/renames ship expand/contract — new field first,
deprecation note here, removal only at a major.

## dev (2026-09-20)

- **Removed** `GET /api/auth/installations` and `POST /api/auth/installations`
  with their operation ids `list-installations` and `select-installation`.
  No credential holds a current installation: every gated request resolves
  the installation from the repository it names, among the installations the
  viewer can reach, and an API token reaches every one of them.
- **Changed** `POST /api/auth/tokens` no longer takes `installationId`; a
  body carrying it is accepted and the field ignored. Token views on the
  mint and list responses no longer carry `installationId`. A pre-release
  change with no compatibility value: a cached web bundle shows its
  generic token-list failure until it reloads.

## dev (2026-09-18)

- **Added** an optional `generation.waitReason` on
  `GET /api/repos/:repoId/pulls/:prNumber`: `debouncing` while the queued
  job's start time is still ahead, `waiting-for-slot` once it is due and no
  worker slot has claimed it. Present only while the generation is `pending`
  and its job is unclaimed; absent otherwise, and never on `GET /api/pulls`
  or `GET /api/briefs` rows. No timestamp is exposed. A client that does not
  know the field, or a value in it, shows its generic pending line.

## dev (2026-09-17)

- **Added** `GET /api/auth/session`: answers `{ "ok": true }` for a request
  carrying a live session cookie, otherwise the session gate's hint-free
  401. Cookie-only like the rest of `/api/auth/*`; a Bearer token is
  ignored. The web app's development-only file-brief readers gate on it.

## dev (2026-09-15)

- **Changed** the instance config key `spend.dailyGenerationCap` is now
  `spend.maxGenerationsPerDay`, and the cap counts generations across every
  repo the instance serves instead of per repo. `spend.perRepo` is removed;
  a file still carrying either old key refuses boot (the block is strict).
  The `capped` status and the `spend.cap.trip` event are unchanged, `repo`
  field included. Pre-release rename with no compatibility value.

## dev (2026-09-14)

- **Changed** the `generation.status` wire value `queued` is now `pending`: a
  Job is queued, a Generation is pending. Pre-release rename with no
  compatibility value, so a client matching on `queued` must be updated.

## dev (2026-09-11)

- **Added** `GET /api/repos/:repoId/pulls/:prNumber/file-range?ref&path&from&to`
  → `{path, ref, from, to, lines, totalLines}`: one file's line window at a
  ref, read live with the viewer's token behind the per-PR gate, `no-store`.
  Backs hunk-edge expansion in the diff view. `from`/`to` are 1-based
  inclusive and both ends clamp to the file, so `lines` always holds
  `to - from + 1` entries and a window past the end answers
  `from = totalLines + 1`, `to = totalLines`. A span wider than 400 lines is
  a 400 `invalid-request`. `ref` is a 40-hex commit SHA, never a branch name,
  so a push cannot serve newer lines at the old line numbers; `path` must be
  repo-relative with no empty, `.` or `..` segment and no control character.
  A path absent at that commit is 404 `file-not-found` (told apart from the
  gate's bare 404 for a repo the reader may not see); a blob over 1 MB is 413
  `file-too-large`; a blob that is not text is 400 `file-not-text`.
- **Added** wire error codes `file-not-found` (404), `file-too-large` (413)
  and `file-not-text` (400).

## dev (2026-08-21 — BRIEF-198)

- **Added** `GET /api/capabilities` → `{operations:[{id, kind,
  classification, endpoint}], catalogFingerprint}` — the registered
  product-operation catalog served as data (id-sorted, `no-store`,
  session-gated on both presentation channels). `catalogFingerprint` is the
  sha256 hex of the committed `product-operations.manifest.json` bytes, so
  a client can detect catalog skew without diffing descriptor lists. Backs
  the `mergebrief capabilities` fail-closed compatibility check (ADR 0029
  as amended: exit 6).

## dev (2026-08-16 — BRIEF-196)

- **BREAKING** — the installation-switch endpoint renamed
  `POST /api/auth/installation` → `POST /api/auth/installations`, so both
  multi-org operations share one prefix (`GET /api/auth/installations` is
  unchanged). The request body, response shape, status codes, and
  cookie-only presentation rule are all unchanged — only the path moved.
  The old singular path now 404s. Pre-OSS-cutover with zero adopters, so it
  ships as a straight rename rather than expand/contract.

## dev (2026-08-03 — BRIEF-20)

- **Added** `capped` to `generation.status` on the PR-view/list responses
  (`generation.status`): the repo hit the instance's daily generation cap
  (`spend.dailyGenerationCap`) and the run was skipped. Terminal, and NOT a
  failure — `error` is null and no attempt is consumed. Clients that treat
  the status set as closed must accept the new value; clients that only
  branch on `succeeded`/`failed` see it as "neither", which is correct.
- **Added** the worker log event `evt: "spend.cap.trip"` (level `warn`,
  fields `repo`, `prId`, `headSha`, `cap`, `dayUtc`) — one line per capped
  skip. Flips the name ADR 0034 reserved; the level is `warn`, not the
  reserved `error`.

## dev (2026-07-21 — BRIEF-51)

- **BREAKING** — the D9 access-log line renamed `evt: "read"` →
  `evt: "api.access"` (ADR 0034; pre-OSS-cutover, zero adopters). The line
  also gains `reqId` and a `msg` field, and levels render as string labels
  (`"level":"info"`). Anything scripted against `evt:"read"` must move to
  `evt:"api.access"`.
- **BREAKING** — the compose web healthcheck moved `/` → `/healthz`.
  Operator probes pointed at `/` still work (it serves the app) but the
  documented health endpoint is now `/healthz`.
- **Added** `GET /healthz` (static liveness) and `GET /readyz` (readiness:
  app composition + `SELECT 1`) — bare top-level paths outside `/api`,
  unauthenticated, constant `{"ok":bool}` JSON (ADR 0034 #7). `/readyz`
  answers 503 when the database is unreachable; compose and orchestrators
  must probe `/healthz`, never `/readyz`.
- **Added** `X-Request-Id` handling on `/api/*`: a valid inbound id
  (charset/length-guarded) is accepted and echoed on the response; a UUID is
  minted and echoed otherwise.

## dev (2026-07-21 — BRIEF-18)

- **BREAKING** — all `/auth/*` routes moved under `/api/auth/*` so the app
  registers ONE external path namespace: `/auth/github` →
  `/api/auth/github`, `/auth/github/callback` → `/api/auth/github/callback`,
  `/auth/logout` → `/api/auth/logout`, `/auth/tokens[/:id]` →
  `/api/auth/tokens[/:id]`, `/auth/installation[s]` →
  `/api/auth/installation[s]`. Old paths now 404 (SSR page router).
  **Every registered GitHub App must update its OAuth callback URL** to
  `<PUBLIC_BASE_URL>/api/auth/github/callback`.
- Bearer presentation rule adjusted with the move (ADR 0016 #4 as
  amended): Bearer is accepted on `/api/*` **except `/api/auth/*`** —
  auth management stays cookie-only, as before.

## dev (2026-07-09 — BRIEF-17)

- **Added** `GET /api/version` → `{version}` (session-gated, both
  presentation channels).
- **Added** `GET /api/repos` → `{repos:[{repoId, fullName}]}` — the
  installation ∩ user-access intersection; flat, unpaginated, `no-store`;
  GitHub failure is a 401/502, never a DB-derived listing.
- **Added** Bearer-token presentation on `/api/*`
  (`Authorization: Bearer mergebrief_...`) — second channel over the same
  session machinery (ADR 0016 #4 as amended). `/auth/*` stays browser-only.
- **Added** `POST /auth/tokens`, `GET /auth/tokens`, and
  `DELETE /auth/tokens/:id` (browser-only token management).
