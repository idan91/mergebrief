# packages/github — agent notes

The GitHub client package for BRIEF-2 (PR A/B/C). This PR (PR A) ships, across
stages: the package scaffold + Zod-parsed env config + GitHub App
authentication (App-JWT client construction and installation-scoped Octokit
minting via `octokit`'s `App` class); and, in stage 2, the typed webhook +
REST **primitives** — webhook HMAC verification, Zod-validated webhook event
parsing (a branded, discriminated `ParsedWebhookEvent`), Entry-comment
post/delete ops, and repo/PR/diff fetch. All API failures funnel through the
single sanitization chokepoint in `src/errors.ts` (`mapRequestError`).

Deliberately NOT here: the event→state mapping / enqueue / tenant writes
(stage 4, a different package composes these primitives) and the reviewer
OAuth flow (PR C).

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

## Test fixtures

`test/fixtures/*.json` are sanitized, trimmed webhook payloads sourced from
`@octokit/webhooks-examples` (GitHub's documented example payloads) — the
recorded-fixture DoD. They are copied in, not imported at test time
(`@octokit/webhooks-examples` is a build-only devDependency). PR B's live smoke
re-verifies parsing against real ngrok-captured deliveries.

## Verification

```sh
pnpm install                       # from repo root, to link this workspace package
pnpm -C packages/github typecheck
pnpm -C packages/github test
pnpm lint                          # repo-root oxlint --type-aware picks this package up
```
