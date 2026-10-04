# MergeBrief CLI — Thin-Client Seam over the Public HTTP API

> **Amended 2026-10-03: one version number.** #6's "the CLI versions
> independently of the server" is superseded. One git tag stamps the server
> image and the npm package alike; a publish stamps the tag's version into
> `apps/cli/package.json` right before build, never committed, and the repo
> keeps `0.0.0`, the dev sentinel that switches the CLI's version checks off
> (`prepublishOnly` and the release workflow refuse to publish the sentinel).
> `mergebrief --version` prints the stamped number.

The product gains a command-line client — **`mergebrief`** — for humans and
AI agents, wrapping the finished read/write API (PR-meta, groups, diff,
delta, conversation, reply, submit). The agent-as-reviewer story is the
sharpest use: a coding agent drives the same review loop a human does, over
`--json` output (BRIEF-17; authorship-neutral framing per ADR 0026 as
amended).

## Decision

1. **CLI only in v1 — no MCP server, no published SDK.** Coding agents
   consume CLIs natively via shell: zero config, CI-friendly. One surface
   serves humans (TTY rendering) and agents (`--json`). An MCP wrapper over
   a `--json` CLI or the HTTP API is cheap to add later; the reverse is a
   rewrite. CLI internals may be SDK-shaped (thin bin over a client module)
   as an implementation choice, but no second public contract ships before
   it has a consumer.
2. **Thin-client hard constraint.** The CLI speaks only the public HTTP API
   at runtime: no `persistence`/`github` package imports, no direct
   Postgres. Compile-time response-type sharing from `packages/types` is
   fine. The CLI is the first genuine external API consumer — gaps it hits
   are API gaps to fix (added to the shared API, e.g. `GET /api/repos`),
   never client-side shortcuts. No dedicated per-CLI endpoints.
3. **Local + deployed = one code path.** A configurable base URL (localhost
   self-host or a deployed instance) over the identical HTTP contract. No
   offline/direct-DB mode.
4. **Pull-only.** Generation is webhook-triggered, never client-initiated-
   and-awaited; "brief not ready" is data in the `--json` payload, not a
   failure. No push, no subscriptions.
5. **Role-neutral client.** No author commands or modes. The API has no
   role concept (the shipped author/reviewer toggle is FE-only), and ADR
   0009's same-shared-Brief posture is expressed purest by a role-neutral
   client. The author story is a documented pre-ready self-review workflow
   over the same commands ("run your reviewer before your reviewer does").
   This makes the CLI a second — **pull** — author Entry during the draft
   window: an *addition* to ADR 0020, not an amendment (0020 rejected a
   draft-PR *comment* as push/noise; the CLI is pull, so its rationale is
   untouched).
6. **Distribution (extends ADR 0017).** Product name **MergeBrief**; the
   bare npm package `mergebrief` IS the CLI (bin `mergebrief`; `@mergebrief/*`
   scope reserved, empty in v1). npm-only single-file bundle,
   `engines: node >=20`; standalone binary deferred. v1 is unpublished:
   `packages/cli` in this monorepo, `private: true`, publishable-shaped,
   dogfooded via `pnpm link --global`. Publishing happens at OSS launch from
   the fresh curated public repo (launch mechanics out of scope). Install
   story at launch: humans `npm i -g mergebrief`, agents/CI
   `npx mergebrief` (always-latest — safe under ADR 0029's additive-only
   promise). CLI has independent semver: `0.x` private, `1.0.0` at launch;
   compatibility = the expand/contract window, never version pinning. The
   server never ships via npm — Docker Compose per ADR 0017.

## Considered Options

- **MCP server first / both from day one.** Rejected: doubled surface
  before a peer touches it (build-in-private posture); MCP's
  progress/subscription machinery buys nothing for a pull-only product
  today. Deliberately NOT pre-deciding whether future MCP wraps the CLI or
  the HTTP API. Revisit trigger: the first workflow that genuinely needs
  push (watch mode, agent waiting mid-flow on regeneration).
- **Published client SDK.** Rejected: no near-term programmatic consumer;
  a second contract to stabilize with no user. Deferred like MCP.
- **Fat client (direct DB / shared server packages).** Rejected: breaks
  liftability and the trust boundary; every capability the CLI needs must
  be a public API capability.
- **Standalone binary distribution.** Deferred. Revisit trigger: first real
  user/agent environment without Node, or CI-image size complaints.

## Consequences

- `GET /api/repos` joins the public API (installation∩user-access repo
  list — the owner/name → repoId resolution the CLI needs; reuses the
  pulls.ts allowed-set machinery).
- Authentication needs a non-cookie presentation: first-class API tokens —
  ADR 0016 #4 as amended (2026-07-09).
- Output shapes become a public contract with stability rules — ADR 0029.
- The web toggle remains the only role-aware layer in the product; if
  BRIEF-30 ever commits to a distinct author view with server-side role
  state, that is a new server concept and a follow-up CLI ticket.

Implementation plan: `docs/plans/brief-17-mergebrief-cli.md`.
