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
manifest and CLI map) ~~and `agentAvailable`. Credential/setup flows an agent
must never drive (token mint/revoke, installation selection surfaces that
exist to bootstrap credentials) ship `agentAvailable: false` and are exempt
from CLI-mapping enforcement.~~

**Amended (2026-08-17, BRIEF-197 →
[ADR 0040](./0040-review-session-server-store.md)):** `agentAvailable` is
**deleted**. It enforced nothing — the real rule is the Bearer path test in
the authz gate — and hand-typed at 23 sites it was already wrong for
`list-tokens` and `list-installations` (both `/api/auth/*`, both 401 to every
token, both parked as CLI gaps demanding an impossible command). The
descriptor drops to four fields: `id`, `kind`, `classification`, `endpoint`.
What a credential may do is its **scope** (`read` / `private-write` /
`external-write`, cumulative) matched against the operation's existing write
classification — the classification IS the permission, so a new operation
cannot be added without declaring who may call it.

Not Product Operations, never registered: OAuth callbacks, logout, webhook
ingest, version checks, UI-only presentation state, CLI profile storage, and
bookkeeping caused automatically by review submission. A public backend
composite is itself a Product Action with its own CLI command; client-only
compositions are not.

### Registration seam

`packages/api/src/product-operations/` owns the catalog (backend owns the
vocabulary; consumers read a generated manifest, never import route code).

Route files keep the existing factory convention, but build on a
`ProductRouter` — a wrapper over Hono where declaring an endpoint and
registering its operation are ONE statement: `.query(descriptor, path,
handler)` mounts a GET, `.action(descriptor, method, path, handler)` mounts a
write, and there is no descriptor-less way to mount a domain route. Descriptor
ids come from a typed vocabulary (`ids.ts`), so an unknown id or a
kind/classification mismatch is a compile error before it is a runtime throw.

Operation ↔ endpoint is 1:1: handler sub-steps never register (automatic
bookkeeping is excluded from the taxonomy), and an endpoint that would serve
two operations is split into two endpoints instead of multi-registering one.
Each registered descriptor carries its endpoint (`METHOD /full/path`),
assembled mechanically: `.route(prefix, child)` absorbs the child router's
declarations under the mount prefix, and the composition root's `commit`
stamps the accumulated full paths — including the top-level `/api` mount —
into the registry. No full path is ever written by hand, and a derived
backstop test pins the composed app's route table (minus the ADR-listed
exempt endpoints) exactly against the registry's endpoint set.

Registration therefore runs at route composition (`createApp`), not module
load: composing the app is what fills the registry, and the manifest
generator composes against stub dependencies without serving. Because tests
compose many apps per process, re-registering an identical descriptor
(endpoint included) is a no-op; the same id with a different descriptor
still throws.

Registration-seam failures — non-kebab id, conflicting descriptor,
kind/classification mismatch, declaring on an already-mounted router — throw
at composition: they are programmer errors a test run surfaces immediately,
not expected failures, so `Result` does not apply.

### Manifests and CI gates

- `packages/api/product-operations.manifest.json` — committed, regenerated
  by script from the registry (compose without serving), byte-compared in
  CI. An unregistered domain route or an edited descriptor shows up as
  manifest drift and fails CI.
- `packages/cli/product-operations.map.json` — operation id → `mergebrief`
  command. A check script enforces exhaustiveness in both directions:
  ~~every `agentAvailable` operation maps to a command~~ **(amended
  2026-08-17, BRIEF-197)** every operation id appears in the map as exactly
  one of `command`, a dated `gap`, or the new permanent `webOnly`
  (`{reason, owner}`) — absence is an error for every id, where the old rule
  *required* web-only ids to be absent — and every mapped id exists in the
  manifest.
- A temporary gap is an explicit entry `{ reason, owner, ticket, expiry }`;
  a missing or expired gap fails CI. The check runs inside `pnpm lint` and
  the CI workflow; it is deterministic and spends nothing.

## Consequences

> **Amended (2026-08-17, BRIEF-197 →
> [ADR 0040](./0040-review-session-server-store.md)):** descriptors are no
> longer static metadata that "never touch a request". `.action()` mounts the
> **scope gate** itself, reading the `classification` already on the
> declaration it receives, so a route added later is enforced whether or not
> its author thought about it. `.query()` mounts none: the ladder is
> cumulative and `read` is its bottom rung, so every scope reaches every
> query. The **audit emit** rides the same
> choke point, keyed on the descriptor's `id`. Authentication stays middleware;
> only authorization-by-class and the audit emit move into the router.

- Adding a domain route without a descriptor, or a descriptor without a CLI
  command, breaks CI instead of silently eroding the agent-complete premise.
- The manifest becomes the machine-readable capability surface for
  downstream consumers (capability fingerprints, packaged skills) without
  coupling them to `packages/api` internals.
- Route authors carry one new obligation: pick an id and a classification.
  Everything else (enumeration, mapping checks) is mechanical.
- The registry is process-global and fills at route composition; a second
  `createApp` in one process re-registers identical descriptors as no-ops.
  Tests that need isolation build their own registry via
  `createProductOperationRegistry()`.
