# packages/types: agent notes

Repo-wide conventions apply (root AGENTS.md states this package's surface and its runtime rule); refinements below.

## Invariants

- **A default object stays with the owner that parses it** (`DEFAULT_DRAFT_POLICY` lives in `generators`' `config/instancePolicy.ts`).
- **Domain subpaths.** Shared shapes and closed vocabularies live in domain files, exported through their domain path (e.g. `types/comments`, `types/drafts`, `types/jobs`) as well as the package root. Helpers stay in `src/utils.ts`, exported through `types/utils`. Single-domain callers use the subpath; callers mixing domains or domain types with helpers use one root import.
