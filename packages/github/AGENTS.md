# packages/github — agent notes

The GitHub client package for BRIEF-2 (PR A/B/C). Stage 1 (this stage, this
PR) ships the package scaffold, a Zod-parsed env config module, and GitHub
App authentication — App-JWT client construction + minting
installation-scoped Octokit clients via `octokit`'s `App` class. Landing in
later stages, not here: webhook HMAC verification, Zod-validated webhook
event schemas, comment operations, diff/PR fetch, repo-access checks, and the
reviewer OAuth flow.

## Invariants (enforced, don't weaken)

- **No DB imports.** This package never imports `drizzle-orm`, `pg`, or any
  query surface from `persistence` at runtime. The sole exception is
  **type-only** imports of branded ids (e.g. `InstallationId`) — `import
  type { InstallationId } from "persistence"` — used to keep id types
  aligned across packages without pulling in the DB layer. `persistence`'s
  `Result`/`ValueOf` are NOT imported this way: this package defines its own
  local copies in `src/types.ts` so it has zero runtime coupling to
  `persistence`.
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

## Verification

```sh
pnpm install                       # from repo root, to link this workspace package
pnpm -C packages/github typecheck
pnpm -C packages/github test
pnpm lint                          # repo-root oxlint --type-aware picks this package up
```
