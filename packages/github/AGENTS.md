# packages/github — agent notes

The GitHub client package: Zod-parsed env config, GitHub App + reviewer-OAuth authentication, typed webhook verification/parsing, and the REST + GraphQL **primitives** the rest of the system composes (Entry-comment ops, repo/PR/diff fetch, review submit, the conversation primitive). All API failures funnel through the single sanitization chokepoint in `src/errors.ts` (`mapRequestError` / `mapGraphqlError`).

Deliberately NOT here: the event→state mapping / enqueue / tenant writes — a different package composes these primitives.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

What the layout can't show:

- HMAC verification is raw-body and constant-time (`webhook/verify.ts`).
- `operations/repo-file.ts` reads with ref unset = default branch (the trust rule).
- `operations/collaborators.ts` lists with affiliation ALL (org/team-granted included).

## Invariants (enforced, don't weaken)

- **No DB imports.** This package never imports `drizzle-orm`, `pg`, or any query surface from `persistence` at runtime. The sole exception is **type-only** imports of branded ids (e.g. `InstallationId`) — `import type { InstallationId } from "persistence"` — used to keep id types aligned across packages without pulling in the DB layer. `Result`/`ValueOf` come from the zero-dependency `types` package via `src/types.ts`.
- **`loadConfig(env)` takes an explicit env map** — never implicit `process.env` at import time. Composition roots (web app, worker) decide when and what to read.
- **All external input validated with Zod** at the boundary it enters — config now; webhook payloads and API responses in later stages.
- **Errors:** expected failures (bad/missing env) return `Result`, never throw. Error messages never carry key material, tokens, or credentials — `ConfigError.issues` lists `field: reason` only, never the offending value (the private key, webhook secret, and OAuth client secret are all credentials).
- **No hand-rolled JWT/token minting.** App-JWT signing and installation access-token minting/caching are owned by `octokit`'s `App` class (`@octokit/auth-app` under the hood) — this package configures it, it never re-implements it.

## GitHub wire facts (bitten-by; keep in mind when touching primitives)

- **A submit is three GitHub objects, not one POST.** REST create-review with no event and no comments opens a PENDING review (numeric id for persistence, node id for GraphQL); one GraphQL `addPullRequestReviewThread` per comment, LINE and FILE alike, attaches to it; GraphQL `submitPullRequestReview` publishes it with the event and body. REST's grouped `comments[]` silently drops `subject_type`, so a FILE comment can only land through the thread mutation. `body` is REQUIRED for the `REQUEST_CHANGES` event.
- **A rejected anchor arrives two ways.** HTTP 200 with `thread: null`, or a thrown GraphQL error whose entry is typed `UNPROCESSABLE` (the shape GitHub uses for a path or line outside the diff); `src/operations/review-thread.ts` returns `anchor-rejected` for both and `request-failed` for everything else, so a caller can fold one comment without treating a transport failure as a rejection.
- **One PENDING review per user per PR.** A pending review left behind by a crash between create and submit makes the next create 422 (`pending-review-exists`). GitHub shows a pending review only to its author, so with the viewer's token any PENDING entry in the review list is theirs; ownership is not consent, so a caller counts its comments first (`countPendingReviewComments`) and deletes only an empty one (`src/operations/review-pending.ts`). DELETE on one already gone is a 404 and folds to ok.
- **422 bodies are unstable**: the discriminating signal sometimes lives ONLY in the top-level `message` with an empty `errors` array — a classifier must scan both (`src/operations/review.ts`). Classification stays best-effort — no stable machine-readable discriminator exists.
- **Octokit throttling is MODULE-GLOBAL**: mutating calls on the `triggersNotification` list (review/comment creation) are spaced ~3s by Bottleneck groups SHARED across every test in a file. In tests, raise the file's `vi.setConfig({ testTimeout })`; never freeze/rewind `Date.now` (fake timers poison the shared limiters for every later GitHub-calling test).

## Test fixtures

`test/fixtures/*.json` are sanitized payloads from `@octokit/webhooks-examples`, copied in, never imported at test time. A live smoke re-verifies parsing against real captured deliveries.
