# 0042: Workspace member kinds: apps, packages, tools

Status: amended (see Amendments)
Date: 2026-09-06

Decided on a wayfinder map (Standards
and lint baseline, apps ticket).

The workspace sorts every member by one test. `apps/` holds members that run
as their own process or ship as their own binary, now or by design: `web`,
`api`, `worker`, `cli`. `packages/` holds code apps share. `tools/` holds
repo-local scripts run by hand, never deployed, never imported.

## Context

`api`, `worker` and `cli` sat under `packages/` beside the libraries they
consume. The folder name said "shared code" while the members were
deployables: the worker has a Dockerfile and a compose service, the CLI ships
as the `mergebrief` binary, and the API is mounted into the web app today
only because its own process is a later ticket. The eval harness in
`tools/categorizer` imported the worker for two pure helpers, so a tool
depended on an app.

## Decision

- **The test.** A member goes in `apps/` when it runs as its own process or
  ships as its own binary, now or by design. It goes in `packages/` when apps
  share it. It goes in `tools/` when it is a repo-local script run by hand.
- **The sort.** `apps/`: `web`, `api`, `worker`, `cli`. `packages/`:
  `brief-core`, `generators`, `github`, `i18n`, `logging`, `persistence`,
  `repo-config`, `types`. `tools/`: `categorizer`, `ingest-briefs`.
- **Nothing imports an app, tests included.** Apps talk over HTTP or the
  Postgres job queue. Shared logic an app owns moves to a package: the
  anchored-generation plan and stitch helpers moved from the worker into
  `brief-core`, which now also owns the `CompareFiles` shape the plan reads.
- **Three `api` edges stay, baselined.** The web app mounts the Hono app at
  runtime, five CLI test files drive the real app in-process, and one `i18n`
  test pins wire wording through the app. dependency-cruiser holds them in
  the known-violations file until the "run the API as its own process" ticket
  lands; that file only loses entries.
- **The HTTP contract between apps is a package both sides import.** When the
  API becomes its own process, `packages/contract` carries the wire shapes
  the web app, the CLI and the API share.

## Consequences

- Workspace package names (`api`, `worker`, `mergebrief`) do not change; only
  paths do. `pnpm-workspace.yaml` already globbed `apps/*`.
- `api` has no process entry, Dockerfile or start script yet. Its placement
  records the design, not the deployment.
- The eval harness depends on `brief-core` and `generators` only.

## Update, 2026-09-08

Both consequences the decision deferred have landed, so the text above reads as
history from here on.

- The three baselined `api` edges are gone. `apps/web` reaches the API over
  HTTP through a server-side proxy, the CLI suites drive the API from its own
  executable, and the catalog wording pin moved to `packages/contract`. The
  known-violations file is deleted and dependency-cruiser runs unsuppressed.
- `packages/contract` exists and carries the wire vocabulary and response
  shapes the API produces and its clients read. It imports `persistence`
  type-only, and `contract-imports-no-runtime` holds that, because `apps/web`
  reaches the package through an isomorphic module.
- `api` now has the process entry, Dockerfile and start script this ADR said it
  lacked.

## Update, 2026-10-05

This update narrows the Tool definition to what holds. A tool is never deployed
and never imported by app or package source; it runs by hand or by CI and lint
(`tools/release` runs in the release workflow, the house plugin in `pnpm
lint`). `no-source-imports-a-tool` holds the import ban at error. Its scope is
`src/` because `apps/web/e2e/harness` imports `ingest-briefs` to seed its
database, and the e2e tree is not shipped source.
