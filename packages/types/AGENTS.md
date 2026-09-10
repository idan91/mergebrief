# packages/types — agent notes

Shared type helpers, the two cross-package shapes no single domain owns, and `as const` maps for closed vocabularies two packages both need as values.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Invariants

- **Zero dependencies.** `package.json` must never grow a dependency. That is what makes the package safe for every member to import, github's no-DB-imports rule included.
- **Runtime is `as const` maps only.** Type aliases, interfaces, and those maps (plus their `ValueOf` unions) are the surface. No functions, no classes, no other values. `house/types-const-maps` holds this at error over `packages/types/**`. A default object (for example `DEFAULT_DRAFT_POLICY`) stays with the owner that parses it.
- **Domain subpaths.** A closed vocabulary two packages both need as a value lives under a domain file (`src/comments.ts`) and is exported as `types/<domain>` as well as from the package root. Helpers stay in `src/utils.ts`.
