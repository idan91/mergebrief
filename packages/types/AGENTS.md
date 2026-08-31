# packages/types — agent notes

The shared TYPE-ONLY utility package: `ValueOf`, `Result`, `Brand`, `MaybePromise`, `Mutable`, `Equals`, plus two deliberate cross-package contracts (`GenerateJobPayload`, `DraftPolicy`). Every workspace package imports these from here instead of re-declaring local copies.

## Invariants (enforced, don't weaken)

- **Types only, zero runtime.** Nothing here may emit JavaScript — no values, no functions, no classes, no `const`. If a helper needs runtime behavior it does NOT belong in this package.
- **Zero dependencies.** `package.json` has no `dependencies`, ever. That is what makes it safe for every other package to depend on — including `github`, whose no-DB-imports rule forbids runtime coupling to `persistence`.
- **Domain types stay in their domains.** Concrete branded id families (`InstallationId`, `RepoId`, ...) and their runtime guards live in `persistence`; only the generic `Brand` mechanism lives here. Closed vocabularies (`PrState`, ...) stay with their owning package. Two deliberate exceptions live here because several packages pin against one shape and no single domain owns it: `GenerateJobPayload` (the enqueue↔drain handshake between `persistence` and `worker`) and `DraftPolicy` (parsed in `generators`, enforced in `api`, mirrored in `apps/web`).

## Conventions

Repo-wide conventions apply (root AGENTS.md); refinements below.

- Doc comments say WHY the type exists, not just what it is.

## Verification

`pnpm -C packages/types typecheck`.

## When to revisit this boundary

Three triggers, and only these, justify reopening the owner-first rule:

1. FE-Zod ↔ API-response drift starts biting ⇒ export a typed wire contract from `api`, which owns the wire — not a central types home.
2. A deployment split or npm consumption ⇒ publish a contract surface at the splitting seam, never a god types package.
3. This package outgrows a few hundred lines ⇒ section it, don't broaden it.

A central domain-types home stays wrong for the same reason each time: it splits types from the Zod schemas and guards that validate them. And this package is zero-dependency, so it can never hold a schema.
