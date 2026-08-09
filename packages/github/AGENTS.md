# packages/github — agent notes

The GitHub client package: Zod-parsed env config, GitHub
App + reviewer-OAuth authentication, typed webhook verification/parsing, and
the REST + GraphQL **primitives** the rest of the system composes
(Entry-comment ops, repo/PR/diff fetch, review submit, the conversation
primitive). All API failures funnel through the single sanitization
chokepoint in `src/errors.ts` (`mapRequestError` / `mapGraphqlError`).

Deliberately NOT here: the event→state mapping / enqueue / tenant writes —
a different package composes these primitives.

## Map

**Entry point: `src/index.ts`** — the package's only export
(`package.json` `exports["."]`); every public symbol is re-exported there,
grouped by folder. Start reading there.

```
src/
  index.ts            ENTRY — sectioned re-exports = the public surface
  types.ts            Result/ValueOf re-export (zero-runtime `types` pkg)
  config.ts           Zod env config (App creds, webhook secret, OAuth client)
  errors.ts           single sanitization chokepoint (mapRequestError +
                      mapGraphqlError taxonomy)
  ids.ts              branded-id guards where GitHub numbers enter
  auth/               how a client gets CONSTRUCTED + AUTHENTICATED
    app.ts              App-JWT client + installation-scoped Octokit minting
    oauth.ts            reviewer OAuth (user-to-server) web flow + refresh
    retry.ts            retry tuning for every Octokit constructed here
  webhook/            what GitHub PUSHES at us
    verify.ts           HMAC verification (raw body, constant-time)
    events.ts           Zod-parsed discriminated ParsedWebhookEvent
  operations/         what we CALL on GitHub (REST + GraphQL)
    comments.ts         Entry-comment post/delete/fetch
    repo.ts             repo lookup + installation-repo listing
    pull-request.ts     PR + files + diff/compare fetch
    review.ts           grouped formal review submit
    conversation.ts     GraphQL conversation primitive
    collaborators.ts    GraphQL repo-collaborators list for the @mention pool
                        (affiliation ALL = org/team-granted included)
    mark-ready.ts       markPullRequestReadyForReview mutation
    inline-comment.ts   standalone inline review-comment write
    resolve-thread.ts   resolve/unresolveReviewThread mutations (walks
                        reviewThreads to map rootCommentId → thread node id)
    repo-file.ts        one-file contents-API read for `.mergebrief/`
                        (ref unset = default branch — the trust rule)
test/                 per-module suites; fixtures/ = sanitized webhook payloads
```

## Invariants (enforced, don't weaken)

- **No DB imports.** This package never imports `drizzle-orm`, `pg`, or any
  query surface from `persistence` at runtime. The sole exception is
  **type-only** imports of branded ids (e.g. `InstallationId`) — `import
  type { InstallationId } from "persistence"` — used to keep id types
  aligned across packages without pulling in the DB layer. `Result`/`ValueOf`
  come from the shared `types` package (types-only, zero runtime, zero
  dependencies — see `packages/types/AGENTS.md`), re-exported via
  `src/types.ts`; that zero-runtime guarantee is what keeps this compatible
  with the no-DB-imports rule.
- **Env is injected, never `process.env`.** `loadConfig(env)` takes an
  explicit env map; nothing in this package reads `process.env` implicitly
  at import time. Composition roots (web app, worker) decide when and what
  to read.
- **All external input validated with Zod** at the boundary it enters —
  config now; webhook payloads and API responses in later stages.
- **Errors:** expected failures (bad/missing env) return `Result`, never
  throw. Error messages never carry key material, tokens, or credentials —
  `ConfigError.issues` lists `field: reason` only, never the offending value
  (the private key, webhook secret, and OAuth client secret are all
  credentials).
- **No hand-rolled JWT/token minting.** App-JWT signing and installation
  access-token minting/caching are owned by `octokit`'s `App` class
  (`@octokit/auth-app` under the hood) — this package configures it, it
  never re-implements it.

## Conventions

- **No `enum`:** `as const` maps + `ValueOf<T>`. Keys SHOUT_CASE, string
  values kebab-case (matches `persistence`).
- **Naming grammar:** verb-first for effects (`loadConfig`,
  `createAppClient`, `getInstallationClient`); noun factories for pure
  constructors.
- Strict TS: no `any`, no bare `as` — brand/narrow via type guards or Zod at
  boundaries.
- **Extensionless relative imports** (`from "./config"`, never `.js"`) —
  bundler-resolved end to end (`moduleResolution: "bundler"`).
- Named exports only.

## GitHub wire facts (bitten-by; keep in mind when touching primitives)

- **Create-review is ATOMIC**: one invalid comment 422s the whole review
  (hence the submit route's all-comments-folded degradation retry, never
  per-comment salvage). `body` is REQUIRED for the `REQUEST_CHANGES` event
  (GitHub documents the same for `COMMENT` — whether a comments-only
  COMMENT is accepted is an open smoke item). Multiple submitted reviews
  per reviewer per commit are allowed.
- **422 bodies are unstable**: the discriminating signal sometimes lives
  ONLY in the top-level `message` with an empty `errors` array — a
  classifier must scan both (`src/operations/review.ts`), and classification stays
  best-effort (no stable machine-readable discriminator exists).
- A force-pushed-away `commit_id` normally still posts, with comments
  rendered "outdated" (assumed from docs — smoke item).
- **Octokit throttling is MODULE-GLOBAL**: mutating calls on the
  `triggersNotification` list (review/comment creation) are spaced ~3s by
  Bottleneck groups SHARED across every test in a file. In tests, raise the
  file's `vi.setConfig({ testTimeout })`; never freeze/rewind `Date.now`
  (fake timers poison the shared limiters for every later GitHub-calling
  test).

## Test fixtures

`test/fixtures/*.json` are sanitized, trimmed webhook payloads sourced from
`@octokit/webhooks-examples` (GitHub's documented example payloads) — the
recorded-fixture DoD. They are copied in, not imported at test time. A live
smoke re-verifies parsing against real ngrok-captured deliveries.

## Verification

```sh
pnpm install                       # from repo root, to link this workspace package
pnpm -C packages/github typecheck
pnpm -C packages/github test
pnpm lint                          # repo-root oxlint --type-aware picks this package up
```
