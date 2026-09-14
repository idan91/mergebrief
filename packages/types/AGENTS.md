# packages/types — agent notes

Shared type helpers, the two cross-package shapes no single domain owns, and `as const` maps for closed vocabularies two packages both need as values.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Invariants

- **Runtime is `as const` maps only.** Type aliases, interfaces, and those maps (plus their `ValueOf` unions) are the surface. No functions, no classes, no other values. `house/types-const-maps` holds this at error over `packages/types/**`. A default object (for example `DEFAULT_DRAFT_POLICY`) stays with the owner that parses it.
- **Domain subpaths.** Shared shapes and closed vocabularies live in domain files, exported through their domain path (e.g. `types/comments`, `types/drafts`, `types/jobs`) as well as the package root. Helpers stay in `src/utils.ts`, exported through `types/utils`. Single-domain callers use the subpath; callers mixing domains or domain types with helpers use one root import.
