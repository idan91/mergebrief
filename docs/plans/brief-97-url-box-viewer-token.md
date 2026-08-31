# Plan — BRIEF-97: Generate-from-URL via the viewer's token (PrSource port)

> Status: **LOCKED — decided with Idan 2026-07-31, implementation starting
> immediately.** Stacked over `feature/BRIEF-88/err-serializer-scrub`
> (PR #194) at Idan's direction.
> Ticket: Notion BRIEF-97 (Now, In progress).
> No ADR: this builds the GitHub-source port the web-generate-from-url plan
> deferred ("ports are M1's job") — M1's `packages/github` landed, so the
> port now composes existing pieces; nothing hard-to-reverse.

## Problem (diagnosed live)

The web URL box shells out to the `gh` CLI
(`brief-core/src/github/fetch.ts`), by design of the original local-loop
plan. In the compose stack the container has no gh binary —
`spawn gh ENOENT` (confirmed in `code-review-web-1` logs) — and the
curated error blames the user ("is it public, gh auth'd?"). App
installation is irrelevant: the box never used that path. Fix = the box
works for any repo the **signed-in viewer** can read, via their
`github_grant` token (BRIEF-40); keyless local dev keeps the gh path.
Env-token (`GH_TOKEN` in compose) shortcut considered and **rejected** by
Idan — straight to the viewer-token end state.

## Correction (2026-07-31, live testing)

GitHub App **user tokens are installation-scoped by GitHub's design** — the
viewer token cannot read a private repo the App is not installed on, even
for the repo's owner. Decision 6's "whatever the viewer's account can read"
therefore holds only for public repos and App-installed repos. The
private-uninstalled case is covered by an opt-in operator PAT
(`MERGEBRIEF_URL_BOX_TOKEN`, `.env.example`) tried only after a
viewer-token NOT_FOUND — the env-token idea returns deliberately narrowed,
with the access-control caveat documented (single-operator instances).
Also found live: cwd-relative OUT_DIR escaped `/app` in-container (fixed —
workspace-root anchor + compose bind mount), and the serverfn
`{ cause }` browser leak (pre-existing critical, fixed in PR 4).

## Locked decisions

1. **PrSource port in brief-core.** Interface mirroring the six gh calls
   `buildInputs`/head-SHA need: `metadata`, `prDiff`, `compareDiff`,
   `reviewComments`, `compareCommitCount`, `resolveFullSha`. The gh CLI
   implementation is the bundled default — CLI and keyless local dev are
   byte-identical in behavior. `linked-context` is raw HTTP + SSRF guard,
   not gh — untouched.
2. **Octokit ops close the gap in `packages/github`.**
   `fetchPullRequest`/`fetchPullRequestFiles`/`fetchDiff`/
   `fetchCompareDiff` exist; add `fetchReviewComments` (REST list, same
   wire shape `normalizeReviewComment` already parses — gh hit the same
   endpoint), `fetchCompareCommitCount` (compare `total_commits`), and
   `resolveFullSha` (commits API) if absent. Client-parameterized like
   every existing op.
3. **New gated route `POST /api/generate` owns orchestration** (authz
   session → `accessToken` + one `spendRefresh` retry, per the
   resolve-thread pattern; parse/validate URL with brief-core
   `parsePrUrl`; dedupe-by-head; single-flight). The engine is an
   injected port on `createApp` deps —
   `{ fetchHeadSha(locator, token), lookupIndex(stem, head),
   generate(url, token) }` — token as string so no octokit type rides the
   port. Route absent engine ⇒ 503 curated copy. packages/api gains a
   `brief-core` dep (parse + stem/briefId helpers + locator types).
4. **apps/web composes the engine impl** (single consumer → lives in
   `features/brief/server/`): token → `createUserOctokit` → octokit
   PrSource adapter → existing file-backed `generateAndWrite` engine
   (OUT_DIR unchanged — artifacts stay the demo file store; DB-backed
   storage for unconnected repos is a future ticket, not this one).
5. **FE routes by visible auth state**: viewer signed in → `apiFetch`
   POST `/api/generate`; signed out → existing server fn (gh path,
   unchanged) — behavior follows visible state, not entry path. Curated
   copy per failure mode: 401 → sign in; 403/404 → no access via your
   account; gh-ENOENT (server-fn path in a container) → "this deployment
   generates via your GitHub sign-in — sign in to continue"; config
   errors pass through as today.
6. **Same-account semantics**: whatever the viewer's GitHub account can
   read, the box can brief. No App installation involved, ever, on this
   path.

## Shape: 4 stacked PRs over PR #194

Same execution setup as BRIEF-88 (confirmed): chunked commits,
`security-reviewer` pre-commit gate, `typescript-eng` + `tdd` mandatory,
reviewer round pre-push, `git-eng` for all git operations, no
AI-attribution anywhere. Not a generation surface (prompt/schema/adapter
defaults untouched) — **no eval run**.

| PR | Branch (stacked in order) | Content | Est. LOC |
|----|---------------------------|---------|----------|
| 1 | `feature/BRIEF-97/pr-source-port` | brief-core: `PrSource` interface + gh impl extraction; `buildInputs`/`generateAndWrite`/head-SHA path take an optional source (default gh); AGENTS.md map note; tests (port-conformance on the gh impl via exec stub) | ~300 |
| 2 | `feature/BRIEF-97/github-read-ops` | packages/github: `fetchReviewComments`, `fetchCompareCommitCount`, `resolveFullSha` ops + tests (existing op test conventions) | ~250 |
| 3 | `feature/BRIEF-97/api-generate-route` | packages/api: engine port type, `POST /api/generate` (authz + refresh retry, dedupe, single-flight, curated errors), `createApp` deps extension, brief-core dep; route tests with fake engine | ~400 |
| 4 | `feature/BRIEF-97/web-viewer-wiring` | apps/web: octokit→PrSource adapter + engine impl, webhookApp wiring, FE auth-state routing + error copy, server-fn copy fix (ENOENT case), tests + **build** (isomorphic-graph gate) | ~350 |

Per-PR model/effort: Opus 5 high, main thread, sequential (design locked
here; execution-heavy). PR bodies name this plan; merge order 1→4 with
squash-stack retargeting per the git-push-workflow recipe.

## Verification

Per-package typecheck+test at each PR (`brief-core`, `github`, `api`,
`apps/web` + build), repo-root lint, and CI path-filter discipline: PR 1
changes a contract consumed by worker/web — run `packages/worker` and
`apps/web` suites locally before pushing. End-to-end: compose stack
rebuild, sign in, paste a private-repo PR URL (e.g. #194), brief renders;
signed-out `pnpm dev` on host still generates via gh.
