# 0039 — Product Operation catalog, route registration, CI drift gates

Status: accepted (2026-08-15). Decided on BRIEF-122 (locked decisions plus
the 2026-08-15 round-2 settlement) and scoped by BRIEF-196; implementation
plan: `docs/plans/brief-196-product-operation-catalog.md`. BRIEF-197 registers
the Review Session actions through the same seam; BRIEF-198+ consume the
manifest.

## Context

The product promise is agent-complete: every authenticated domain operation a
human can perform in the web app has a CLI equivalent an agent can drive.
Nothing enforces that premise. Routes register ad hoc in
`packages/api/src/app.ts`, the CLI grows commands by convention, and the only
way to know whether an operation is missing from either surface is to read
both by hand. As the surface grows (Review Session alone adds ~17 actions),
that audit stops being performable.

## Decision

### Taxonomy

A **Product Operation** is one authenticated domain operation. Two kinds:

- **Product Query** — read-only (`kind: "query"`, classification `read`).
- **Product Action** — state-changing (`kind: "action"`), classified
  `private-write` (state confined to this instance) or `external-write`
  (leaves the instance: GitHub reviews, comments, thread state).

Each operation carries a stable kebab-case `id` (the join key across
manifest and CLI map) and `agentAvailable`. Credential/setup flows an agent
must never drive (token mint/revoke, installation selection surfaces that
exist to bootstrap credentials) ship `agentAvailable: false` and are exempt
from CLI-mapping enforcement.

Not Product Operations, never registered: OAuth callbacks, logout, webhook
ingest, version checks, UI-only presentation state, CLI profile storage, and
bookkeeping caused automatically by review submission. A public backend
composite is itself a Product Action with its own CLI command; client-only
compositions are not.

### Registration seam

`packages/api/src/product-operations/` owns the catalog (backend owns the
vocabulary; consumers read a generated manifest, never import route code).

Route files keep the existing factory convention untouched. Each operation
is declared with one top-level call beside its factory —
`registerProductQuery(descriptor)` / `registerProductAction(descriptor)` —
which validates the descriptor and records it in the registry. The calls run
at module load, so importing the route module is what registers it; a
factory serving several operations makes one call per operation, one per
line. Handlers stay colocated; `app.ts` composition, factory signatures, and
factory bodies are unchanged.

Registration-seam failures — duplicate id and non-kebab id in the registry,
kind/classification mismatch in the registrars — throw at load: they are
programmer errors a test run surfaces immediately, not expected failures, so
`Result` does not apply.

### Manifests and CI gates

- `packages/api/product-operations.manifest.json` — committed, regenerated
  by script from the registry (compose without serving), byte-compared in
  CI. An unregistered domain route or an edited descriptor shows up as
  manifest drift and fails CI.
- `packages/cli/product-operations.map.json` — operation id → `mergebrief`
  command. A check script enforces exhaustiveness in both directions:
  every `agentAvailable` operation maps to a command, every mapped id
  exists in the manifest.
- A temporary gap is an explicit entry `{ reason, owner, ticket, expiry }`;
  a missing or expired gap fails CI. The check runs inside `pnpm lint` and
  the CI workflow; it is deterministic and spends nothing.

## Consequences

- Adding a domain route without a descriptor, or a descriptor without a CLI
  command, breaks CI instead of silently eroding the agent-complete premise.
- The manifest becomes the machine-readable capability surface for
  downstream consumers (capability fingerprints, packaged skills) without
  coupling them to `packages/api` internals.
- Route authors carry one new obligation: pick an id and a classification.
  Everything else (enumeration, mapping checks) is mechanical.
- The registry is process-global and fills at module load; a second
  `createApp` in one process re-registers nothing because registration rides
  imports, not calls. Tests that need isolation build their own registry via
  `createProductOperationRegistry()`.
