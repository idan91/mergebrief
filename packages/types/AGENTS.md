# packages/types — agent notes

The shared TYPE-ONLY utility package: `ValueOf`, `Result`, `Brand`,
`MaybePromise`. Every workspace package imports these from here instead of
re-declaring local copies.

## Invariants (enforced, don't weaken)

- **Types only, zero runtime.** Nothing here may emit JavaScript — no values,
  no functions, no classes, no `const`. If a helper needs runtime behavior it
  does NOT belong in this package.
- **Zero dependencies.** `package.json` has no `dependencies`, ever. This is
  what makes the package safe for every other package — including `github`,
  whose no-DB-imports rule forbids runtime coupling to `persistence` — to
  depend on.
- **Domain types stay in their domains.** Concrete branded id families
  (`InstallationId`, `RepoId`, ...) and their runtime guards live in
  `persistence`; only the generic `Brand` mechanism lives here. Closed
  vocabularies (`PrState`, ...) stay with their owning package.

## Conventions

Named exports only; extensionless relative imports; strict TS. Same doc-comment
style as the rest of the repo: say WHY the type exists, not just what it is.

## Verification

```sh
pnpm -C packages/types typecheck
```
