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

## dev (2026-09-24)

- **Added** `asOf` on `GET /api/repos/:repoId/pulls/:prNumber/stack`: for a
  merged or closed pull request the live open list no longer resolves a
  stack for, `stack` is the last one recorded on the row and `asOf` is the
  ISO time it was recorded. An open pull request without live neighbours
  still answers `stack: null` and no `asOf`; open or closed is GitHub's
  answer on the read, not the stored row state. Every live resolve is
  folded into the row's record, and the worker folds in the stack it sees at
  generation too: a chain that lost merged ancestors gets them grafted back,
  so a closed pull request answers the full chain it was part of, and
  `asOf` is when the record last changed, not the last read.
- **Changed** the stored fallback for `stack` on `GET /api/inbox` items: a
  merged or closed row the live open list no longer holds now keeps the
  last stack recorded on the pull request row rather than the snapshot
  inside its latest brief body. An open row without a live entry, including
  one whose list GitHub refused, is `null`: the same rule the brief header
  applies, since an open pull request the list does not place has no stack.
  Rows never read since the column landed report `null` until the next
  brief read or generation records one.
- **Changed** the reviewer session cookie is `__Host-mergebrief_session` (was
  `rs_session`) and the OAuth state cookie `__Host-mergebrief_oauth_state`. Both are
  `Secure` unconditionally, and the prefix forbids a `Domain` attribute, so a
  sibling subdomain on the same apex can no longer shadow them. Every
  signed-in reviewer signs in again once after upgrading; the old session
  rows fall to the expiry sweep. Bearer clients are unaffected.
- **Changed** a cookie-authenticated `POST`, `PUT`, `PATCH` or `DELETE`
  (`POST /api/auth/logout` included) now needs `Sec-Fetch-Site:
  same-origin` or an `Origin` equal to `PUBLIC_BASE_URL`'s origin, and
  answers 403 `forbidden` otherwise. Browsers send one of the two on every
  such request, so a page served from `PUBLIC_BASE_URL` is unaffected; a
  script driving the API with a session cookie sets one of them. Bearer
  requests are exempt. `PUBLIC_BASE_URL` must now parse as an absolute
  `http(s)` URL, checked at boot.
- **Added** `DELETE /api/auth/sessions` (`revoke-sessions`, private-write):
  revokes every session of the signed-in reviewer, the caller's own
  included, clears the cookie and answers `{ ok: true, revoked }`.
  Cookie-only like the token surface, so a Bearer token cannot sign its
  owner out; a token minted off one of the revoked sessions keeps working.

## dev (2026-09-22)

- **Added** `layout` query on `GET /api/inbox`: `folded` (the default) leads
  with the rows that need the viewer before the sort; `mixed` orders the
  page by the sort alone. Numbered pages follow the layout, so a layout
  change is read from page one.

## dev (2026-09-21)

- **Changed** `counts` on `GET /api/inbox`: the four review-state totals now
  cover only the open, non-draft rows the viewer can see. A merged, closed
  or draft pull request no longer counts as new or changed, whatever the
  status filter shows. The viewer's own rows carried no state before and
  still carry none.
- **Fixed** `viewerIsAuthor` and `reviewState` on `GET /api/inbox` items and
  `viewerIsAuthor` on `GET /api/repos/:repoId/pulls/:prNumber` for a url row
  ingested before its author was recorded: the live read now writes the
  author GitHub names, so the viewer's own row stops reading as new to them
  once it is read again.
- **Changed** `stack` on `GET /api/inbox` items: for a pull request GitHub
  still lists as open, the position now comes from the repository's live
  open-PR list, read with the viewer's token and cached per session for a
  minute, the same read `GET /api/repos/:repoId/pulls/:prNumber/stack`
  makes. A row the list no longer holds, or whose list GitHub refused,
  keeps the position stored with its latest brief, as before; a row the
  list holds as a fork or on its own is `null` even when a stored position
  said otherwise. A url row's list is read under the name its last
  successful live read recorded after matching the repository id; a row
  GitHub no longer shows the viewer keeps its stored position.

## dev (2026-09-20)

- **Added** `viewer` on `GET /api/auth/session`: `{ login, avatarUrl }` for
  the signed-in reviewer, the same shape the Inbox response carries, so a
  header can show who is signed in without listing anything.
- **Added** `GET /api/inbox` (`list-inbox`): the viewer's pull requests
  across every installation they reach plus their own pasted-URL rows, as
  numbered pages of 25 (`items`, `page`, `pageSize`, `total`, no `hasNext`;
  a page past the end returns no items with the true total). Query keys
  `page`, `sort` (`updated` | `generated`), `state` (repeatable: `open`,
  `draft`, `merged`, `closed`; default open and draft), `repo`, `review`
  (`new`, `in-progress`, `reviewed`, `updated`), `author` (`mine`,
  `others`, `all`), `installation`. Each item carries `reviewState`,
  `behind`, `unreachable`, `generation`, `latestBriefAt`, `githubUpdatedAt`
  and `stack`; the response carries `counts`, `viewer`,
  `reachableInstallations` and `repositories` (every repository the
  viewer's rows name, unfiltered, sorted by slug, at most 100: the
  Repository filter's vocabulary) and `installUrl` (the App's
  new-installation page, or null when the instance set no
  `GITHUB_APP_SLUG`). A GitHub failure on the installations check
  fails the list with `github-unavailable`. Pasted-URL rows are read live
  first, for up to two seconds.
- **Added** `DELETE /api/inbox/:repoId/:prNumber` (`delete-inbox-item`),
  the owner-delete of a pasted-URL row.
- **Removed** `GET /api/pulls` (`list-pulls`), `GET /api/briefs`
  (`list-url-briefs`) and `DELETE /api/briefs/:repoId/:prNumber`
  (`delete-url-brief`): the Inbox and its delete replace all three, and
  `mergebrief pr` already reads `GET /api/inbox`.
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
