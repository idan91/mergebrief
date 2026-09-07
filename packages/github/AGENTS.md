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

- **No DB imports.** This package never imports `drizzle-orm`, `pg`, or any query surface from `persistence` at runtime. The sole exception is **type-only** imports of branded ids (e.g. `InstallationId`) — `import type { InstallationId } from "persistence"` — used to keep id types aligned across packages without pulling in the DB layer. `Result`/`ValueOf` come from the zero-runtime `types` package via `src/types.ts`.
- **`loadConfig(env)` takes an explicit env map** — never implicit `process.env` at import time. Composition roots (web app, worker) decide when and what to read.
- **All external input validated with Zod** at the boundary it enters — config now; webhook payloads and API responses in later stages.
- **Errors:** expected failures (bad/missing env) return `Result`, never throw. Error messages never carry key material, tokens, or credentials — `ConfigError.issues` lists `field: reason` only, never the offending value (the private key, webhook secret, and OAuth client secret are all credentials).
- **No hand-rolled JWT/token minting.** App-JWT signing and installation access-token minting/caching are owned by `octokit`'s `App` class (`@octokit/auth-app` under the hood) — this package configures it, it never re-implements it.

## GitHub wire facts (bitten-by; keep in mind when touching primitives)

- **Create-review is ATOMIC**: one invalid comment 422s the whole review (hence the submit route's all-comments-folded degradation retry, never per-comment salvage). `body` is REQUIRED for the `REQUEST_CHANGES` event (GitHub documents the same for `COMMENT` — whether a comments-only COMMENT is accepted is an open smoke item). Multiple submitted reviews per reviewer per commit are allowed.
- **422 bodies are unstable**: the discriminating signal sometimes lives ONLY in the top-level `message` with an empty `errors` array — a classifier must scan both (`src/operations/review.ts`). Classification stays best-effort — no stable machine-readable discriminator exists.
- **Octokit throttling is MODULE-GLOBAL**: mutating calls on the `triggersNotification` list (review/comment creation) are spaced ~3s by Bottleneck groups SHARED across every test in a file. In tests, raise the file's `vi.setConfig({ testTimeout })`; never freeze/rewind `Date.now` (fake timers poison the shared limiters for every later GitHub-calling test).

## Test fixtures

`test/fixtures/*.json` are sanitized payloads from `@octokit/webhooks-examples`, copied in, never imported at test time. A live smoke re-verifies parsing against real captured deliveries.
