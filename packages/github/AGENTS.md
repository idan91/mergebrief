# packages/github: agent notes

The GitHub client package: Zod-parsed env config, GitHub App + reviewer-OAuth authentication, typed webhook verification/parsing, and the REST + GraphQL **primitives** the rest of the system composes (Entry-comment ops, repo/PR/diff fetch, review submit, the conversation primitive). All API failures funnel through the single sanitization chokepoint in `src/errors.ts` (`mapRequestError` / `mapGraphqlError`).

Deliberately NOT here: the event→state mapping / enqueue / tenant writes: a different package composes these primitives.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

What the layout can't show:

- HMAC verification is raw-body and constant-time (`webhook/verify.ts`).
- `operations/repo-file.ts` reads with ref unset = default branch (the trust rule).
- `operations/collaborators.ts` lists with affiliation ALL (org/team-granted included).
- `operations/mentions/` reads only on the reviewer token, so nobody GitHub hides from the viewer is suggested. Teams need the org permission Members read; an installation that has not approved it answers forbidden.
- `operations/partial-data.ts` reads the data octokit's throw still carries for an aliased query; a NOT_FOUND alias is an answer, not a failure.
- `client/operator-owner.ts` resolves the operator PAT's owner once at boot (`GET /user`) and serves that id only. A 401, a non-rate-limit 403 or a 404 refuses it for the process lifetime; any other failure serves nobody while an unref'd timer retries (30 s doubling to 15 min).

## Invariants (enforced, don't weaken)

- **No DB imports.** This package never imports `drizzle-orm`, `pg`, or any query surface from `persistence` at runtime. The sole exception is **type-only** imports of branded ids (e.g. `InstallationId`), `import type { InstallationId } from "persistence"`, used to keep id types aligned across packages without pulling in the DB layer. `Result`/`ValueOf` come straight from the zero-dependency `types` package.
- **`loadConfig(env)` takes an explicit env map** and returns `Result`. The composition roots, `apps/api/src/main.ts` (through its `src/boot/`) and `apps/worker/src/main.ts`, decide when and what to read.
- **`ConfigError.issues` lists `field: reason` only**, never the offending value: the private key, webhook secret and OAuth client secret are all credentials.
- **No hand-rolled JWT/token minting.** App-JWT signing and installation access-token minting/caching are owned by `octokit`'s `App` class (`@octokit/auth-app` under the hood). This package configures it, it never re-implements it.

## GitHub wire facts (bitten-by; keep in mind when touching primitives)

- **A submit is three GitHub objects, not one POST.** REST create-review with no event and no comments opens a PENDING review (numeric id for persistence, node id for GraphQL); one GraphQL `addPullRequestReviewThread` per comment, LINE and FILE alike, attaches to it; GraphQL `submitPullRequestReview` publishes it with the event and body. REST's grouped `comments[]` silently drops `subject_type`, so a FILE comment can only land through the thread mutation. `body` is REQUIRED for the `REQUEST_CHANGES` event.
- **A rejected anchor arrives two ways.** HTTP 200 with `thread: null`, or a thrown GraphQL error whose entry is typed `UNPROCESSABLE` (the shape GitHub uses for a path or line outside the diff); `src/operations/review-thread.ts` answers the `anchor-rejected` code for both and the sanitized code for everything else, so a caller can fold one comment without treating a transport failure as a rejection. A GitHub refusal is always a `GitHubApiError` told apart by `code`; an operation that classifies a 422 sets the code (`anchor-rejected`, `unknown-commit`, `pending-review-exists`), never a side field.
- **One PENDING review per user per PR.** A pending review left behind by a crash between create and submit makes the next create 422 (`pending-review-exists`). GitHub shows a pending review only to its author, so with the viewer's token any PENDING entry in the review list is theirs; ownership is not consent, so a caller counts its comments first (`countPendingReviewComments`) and deletes only an empty one (`src/operations/review-pending.ts`). DELETE on one already gone is a 404 and folds to ok.
- **422 bodies are unstable**: the discriminating signal sometimes lives ONLY in the top-level `message` with an empty `errors` array. A classifier must scan both (`src/operations/review.ts`). Classification stays best-effort: no stable machine-readable discriminator exists.
- **`octokit.graphql` reads some variable names as request options.** `query`, `method` and `url` throw before any request leaves; `headers`, `request`, `baseUrl`, `mediaType` and `operationName` are taken silently and never reach GitHub. Name variables otherwise (`$search`). A test that stubs `graphql` cannot catch this; the contract suite on the real octokit does.
- **Octokit throttling is MODULE-GLOBAL**: mutating calls on the `triggersNotification` list (review/comment creation) are spaced ~3s by Bottleneck groups SHARED across every test in a file. In tests, raise the file's `vi.setConfig({ testTimeout })`; never freeze/rewind `Date.now` (fake timers poison the shared limiters for every later GitHub-calling test).

## Test fixtures

`test/fixtures/*.json` are sanitized payloads from `@octokit/webhooks-examples`, copied in, never imported at test time. A live smoke re-verifies parsing against real captured deliveries.
