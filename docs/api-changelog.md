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

## dev (2026-10-19)

- **Changed** `GET /api/inbox` and `GET /api/repos/:repoId/pulls/:prNumber`
  read installation pull requests live too, on the viewer's token, as a
  backstop for a webhook that never arrived: an open installation row's
  `draft`, `state`, `title` and author can change on read, and its
  `behind` can now be true. Url rows are still read first, for up to two
  seconds across both. A live read never queues a generation.

## dev (2026-10-12)

- **Changed** every `/api/*` request body is capped at 1 MiB: a larger one,
  declared or streamed, answers `413 request-too-large` before the session
  layer runs, so no credential is checked. Before, an oversized
  unauthenticated POST answered 401 and an oversized signed-in write was
  parsed or answered 400. `POST /api/repos/:repoId/pulls/:prNumber/attachments`
  is exempt and keeps its own larger upload cap.
- **Removed** `catalogFingerprint` from `GET /api/capabilities`, and
  `serverCatalogFingerprint`, `cliCatalogFingerprint` and `fingerprintMatch`
  from `mergebrief capabilities --json`. Removed before the first release,
  so no shipped client reads them. The version number is the skew signal;
  `--require` still checks the operations an agent needs.
- **Removed** the error codes `app-not-installed`, `generation-failed`,
  `generation-unavailable` and `generation-config`, which no route emitted,
  and the `params` field of the error body: every `/api/*` error body is now
  `{ error, code }`. Removed before the first release, so no shipped client
  reads them.
- **Changed** archive to `POST /api/repos/:repoId/pulls/:prNumber/archive`
  (was `PUT` on the same path) and unarchive to
  `POST /api/repos/:repoId/pulls/:prNumber/unarchive` (was `DELETE` on
  `.../archive`). Both answer `204` with no body (was `200 { ok: true }`).
  The old `PUT` and `DELETE` on `.../archive` are removed before the first
  release and now answer `404`.
- **Changed** `DELETE /api/repos/:repoId/pulls/:prNumber`,
  `DELETE /api/inbox/:repoId/:prNumber` and
  `DELETE /api/repos/:repoId/attachments` to answer `204` with no body (was
  `200 { ok: true }`). Methods, paths and error answers are unchanged.
- **Changed** the Review Session writes that echoed their request to answer
  `204` with no body: `PATCH` and `DELETE`
  `/api/repos/:repoId/pulls/:prNumber/session/comments/:draftId` and
  `PUT .../session/comments/:draftId/anchor` (were `200 { draftId }`), and
  `PUT .../session/groups/:groupId/classification` (was
  `200 { changeGroupId, category }`). Removed before the first release.
  `mergebrief draft update|reanchor|delete` and `reclassify` now print
  nothing on success and exit 0.
- **Changed** `POST .../session/risks/dismiss`, `.../risks/address` and
  `.../risks/reopen` to answer `200 { count }` (was `200 { flags }`, the
  same number under a new name). Removed before the first release;
  `mergebrief risk dismiss|address|reopen` relays `{"count":n}`.
- **Removed** the `set-chunk-read` operation,
  `PUT /api/repos/:repoId/pulls/:prNumber/session/chunks/:chunkId/read` with
  body `{ read }` answering `200 { chunkId, read }`. Removed before the first
  release; the old `PUT` now answers `404`.
- **Added** `mark-chunk-read`, `POST .../session/chunks/:chunkId/read`, and
  `mark-chunk-unread`, `POST .../session/chunks/:chunkId/unread`. Neither
  takes a body; both answer `204` with no body and keep the old operation's
  `private-write` classification and policy. `mergebrief chunk-read` sends
  the first, `--unread` the second, and prints nothing on success.
- `POST .../session/comments` (`201 { draftId }`) and
  `PUT .../session/outcome` (`200 { outcome }`, read back off the stored
  session) are unchanged.
- **Changed** `POST /api/repos/:repoId/pulls/:prNumber/ready` to answer
  `204` with no body (was `200 { draft: false }`, an echo of the request).
  Removed before the first release. `mergebrief ready` now prints nothing
  on success and exits 0.
- **Changed** `POST /api/generate` to answer `202 { repoId, prNumber }`
  (was `200` with the same body): the request queues generation in the
  worker. `mergebrief generate` relays the body verbatim. A `url` longer
  than 500 characters is still a deterministic `400 invalid-request`.
- `POST /api/repos/:repoId/pulls/:prNumber/review` (`201 { reviewId,
  commentsDegraded, commentsFolded, commentsTotal }`) is unchanged.
- **Changed** `DELETE /api/auth/tokens/:id` to answer `200 { apiToken }`
  (was `200 { ok: true, apiToken }`) and `DELETE /api/auth/sessions` to
  answer `200 { revoked }` (was `200 { ok: true, revoked }`). Removed before
  the first release.
- **Changed** `POST /api/version/dismiss` and `POST /api/auth/logout` to
  answer `204` with no body (were `200 { ok: true }`). Logout now also sends
  `cache-control: no-store`. Removed before the first release.
- **Changed** `GET /api/auth/session` to answer `200 { viewer }` (was
  `200 { ok: true, viewer }`). Removed before the first release.
- **Changed** `POST /api/auth/tokens` to refuse a whitespace-only `name` with
  `400 invalid-request`, and to store the name trimmed; the 100-character
  cap counts the trimmed name. `DELETE /api/auth/tokens/:id` with an id past
  the `int8` range answers `404` (was `500`).
- `POST /api/auth/tokens` (`201 { token, apiToken }`) and
  `GET /api/auth/tokens` (`200 { tokens }`) are unchanged.

## dev (2026-10-11)

- **Added** `authorLogin` (string | null) on `GET /api/repos/:repoId/pulls/:prNumber`
  and on each `GET /api/inbox` item: the PR author's GitHub login, `null`
  when the stored row has none. A client that predates it ignores the field.
- **Added** the api and worker log event `evt: "url-box-token.owner.fail"`
  (level `error`, fields `status`, `code`): GitHub refused
  `MERGEBRIEF_URL_BOX_TOKEN` at boot, so it serves nobody until the token is
  replaced and the process restarts. The token now serves only the GitHub
  account that owns it; `MERGEBRIEF_URL_BOX_TOKEN_REVIEWERS` is no longer
  read. No response shape changes.
- **Added** the wire code `signed-out` (401): a cookie request with no
  session cookie, an unknown session or an expired one answers
  `401 signed-out` (was `401 unauthorized`), so a browser can tell a
  session that is gone from a live one GitHub refused. A refused Bearer
  token and every other 401 still answer `unauthorized`.
- **Changed** the check order under `/api/repos/:repoId/pulls/:prNumber`:
  a pull request this instance holds no row for answers `404 not-found`
  before the body or query is read (a malformed body was `400`), and a
  malformed `:prNumber` answers 404 like a malformed repo id (was `400`).
  `DELETE .../pulls/:prNumber` answers 404 for a missing row before the
  admin check (a non-admin got `403 repo-admin-only`).
- **Changed** a Bearer token on a human-only operation answers
  `403 human-only` before its input is validated (a malformed body or PR
  number answered `400` first). Human-only: deleting a pull request's
  briefs on either route, editing a draft's anchor, deleting a draft,
  dismissing, addressing or reopening a risk, purging attachments, and
  dismissing the version notice.
- **Changed** the per-repo gate in front of every `/api/repos/:repoId/*`
  route: a GitHub outage, rate limit or failed request at the access check
  answers `502 github-unavailable` (was 404). It is never cached and never
  tried on the operator token. A 404 there now always means GitHub refused
  access or the repository is gone, so a client can tell "try again" from
  "you lost access".
- **Changed** a GitHub 401 that survives the request's token refresh answers
  `401 unauthorized` (was 404 at the gate, 502 on the reads below). The
  refreshed token is the one GitHub rejected, so signing in again is the
  fix. Affects the gate and `GET .../pulls/:prNumber/diff`, `.../stack`,
  `.../file-range` and `.../attachments/:assetId`. The session is kept.
- **Changed** a GitHub 403 on `GET .../pulls/:prNumber/diff` and
  `GET .../pulls/:prNumber/conversation` answers `404 not-found` (was 502),
  and on `GET /api/repos/:repoId/collaborators` the same (was 502). A read
  collapses a refusal to absence like the gate does; only an outage is 502.
  The conversation read on an App-installed repository still answers an App
  credential 401 as `502 github-unavailable`: a sign-in cannot repair the
  instance's own credential.
- **Changed** a GitHub 403 on `POST .../pulls/:prNumber/comments` (publish
  a draft now) answers `403 github-permission` (was 404), as a review
  submit already does. The viewer proved access at the gate and the fresh
  re-resolve, so the refusal is their permission to comment, not absence.
  The draft's claim is released as before.
- **Changed** a GitHub 403 whose message names a secondary rate limit, with
  no `retry-after` and budget left in `x-ratelimit-remaining`, answers
  `502 github-unavailable` like any other rate limit (it was read as a
  permission refusal: `404 not-found` or `403 github-permission`).
- **Changed** the `error` line of `github-unavailable` reads
  `github is unavailable or rate limited` (was `upstream error`). The code
  and status are unchanged.

## dev (2026-10-06)

- **Added** `attempts-exhausted` to the generation failure codes a
  generation's `errorCode` carries: the head used all its claims since its
  last trigger and will not retry until a new trigger arrives. It carries no
  `detail`. A client that predates it renders the generic failed line.
- **Added** `maxAttempts` to the worker log event `job.retries.exhausted`,
  which now also fires when a head's claims are spent.

## dev (2026-10-04)

- **Added** `429 attachment-limit-reached` on
  `POST /api/repos/:repoId/pulls/:prNumber/attachments`: each reviewer may
  upload 10 files or 30 MB per 10 minutes by default (operator-set through
  `MERGEBRIEF_ATTACHMENT_QUOTA_*`), cookie and Bearer counted together, per
  api replica. The answer is `no-store` and carries `Retry-After` in whole
  seconds until the reviewer's window ends. A client that attaches in bulk
  should stop on it and retry after that delay.

## dev (2026-09-27)

- **Added** `POST /api/repos/:repoId/pulls/:prNumber/attachments`
  (`upload-attachment`), behind the per-PR gate, App-installed repositories
  only: the raw bytes of one PNG, JPEG, GIF or WebP image (10 MB cap,
  `content-type` declares the type and the bytes must agree) are committed
  to the repository's `mergebrief/attachments` branch on the App's token,
  and the answer is `201 { url }`, the GitHub blob URL a comment carries.
  External write: a Bearer principal at `external-write` may call it. Two
  wire codes ride with it: `403 attachments-disabled` when a rule on the
  branch refuses the push, and `400 attachment-unsupported-type`; an App
  that may not push at all (Contents left read-only, an archived
  repository) answers the existing `403 github-permission`.
- **Added** `GET /api/repos/:repoId/pulls/:prNumber/attachments/:assetId`
  accepts `<uuid>.<ext>` as well as a bare asset id, serving a file from the
  attachments branch with the viewer's token.

## dev (2026-09-24)

- **Added** `PUT` and `DELETE /api/repos/:repoId/pulls/:prNumber/archive`
  (`archive-pull`, `unarchive-pull`), behind the per-PR gate: the viewer's
  own archive of one inbox row, per reviewer, anchored on the latest
  brief's head. A brief at a new head lifts it; a brief at the same head,
  a retarget, does not. Private writes: a Bearer principal at
  `private-write` or above may call them.
- **Added** `archived` on `GET /api/inbox`: `hide` (the default) leaves the
  viewer's archived rows out of the page, the total and the repositories;
  `only` lists nothing else. `counts` never includes an archived row in
  either view. The response carries `archivedTotal`, the viewer's archived
  rows whatever the filters or the view, beside `total`.
- **Added** `DELETE /api/repos/:repoId/pulls/:prNumber` (`delete-pull`),
  behind the per-PR gate: erases one pull request's briefs and everything
  hanging off them. Cookie only (`human-only` for a Bearer principal). An
  installation row needs `permissions.admin` on a fresh read of the
  repository with the viewer's token, else 403 `repo-admin-only`. The
  route is App-only: an owner world, the operator-PAT rung included, is a
  404, and a pasted-URL row is `delete-own-pull`'s. When an admin deletes
  an installation row and also holds a pasted-URL row for the same pull
  request, both go. The purge's audit row names the reviewer.
- **Added** the wire code `repo-admin-only` (403).
- **Changed** `DELETE /api/inbox/:repoId/:prNumber`: the operation is
  `delete-own-pull` (was `delete-inbox-item`), so an audit or access ledger
  query on the old id stops at this release; cookie only now (`human-only`
  for a Bearer principal, which could call it before); and the purge's
  audit row names the reviewer (was the App). The path, the owner-only
  scope and the absence of any GitHub call are unchanged: a pasted row
  whose repository nobody can read any more still goes, and a row in any
  installation, or another reviewer's paste, is an indistinguishable 404.
- **Added** `viewerCanDelete` on `GET /api/inbox` items: true on the
  viewer's own pasted-URL rows, and on an installation row when the
  viewer administers its repository as GitHub listed it.
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
