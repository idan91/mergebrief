# packages/repo-config — agent notes

The `.mergebrief/` repo-local config surface. Turns raw file
contents (server-fetched from the default branch, or CLI working-tree reads
later) into a validated, budget-checked config the generator consumes. This
package is **pure and source-agnostic** — it never fetches, never touches the
filesystem, never talks to GitHub. It takes strings in and returns outcomes.

## Map

**Entry point: `src/index.ts`** — the package's only export
(`package.json` `exports["."]`); every public symbol is re-exported there,
grouped by module. Start reading there.

```
src/
  index.ts      ENTRY — sectioned re-exports = the public surface
  constants.ts  fixed paths, budget caps (schema constants, versioned with
                the schema), floor attributes, parked/reserved vocabulary,
                the RepoConfigOutcomes map
  schemas.ts    Zod (imported as `zod/v4`): settingsV1Schema, policyV1Schema
                — .strict() everywhere; attribute-name charset is a security
                control (names later extend a model json_schema enum)
  validate.ts   validateRepoConfig(input) — the consumer-facing contract:
                reject-whole, byte-budget caps (outside Zod), warn-before-
                reject, collision resolution (built-in wins + chip),
                de-emphasis floor rejection, warn-and-drop unknown targets
test/           per-concern vitest suites
```

## Invariants (enforced, don't weaken)

- **Reject-whole:** a file that fails parse / schema / caps
  contributes NOTHING — never partial use. Outcome `invalid` or
  `over-budget`; generation proceeds without it (caller's concern).
- **Secret/echo hygiene:** outcome `detail`/`warning` strings
  carry `path` + a sanitized reason ONLY. Never echo file content, YAML
  values, secrets, or raw `yaml`-lib parse messages (they can quote source).
  Zod issue paths/codes are fine; `received` values are NOT.
- **Built-in vocabulary is imported, never duplicated:** `RiskSurfaceAttributes`
  comes from `brief-core`. Collisions (custom name ∈ built-in ∪ parked ∪
  reserved) fail TOWARD built-in semantics — drop the custom def, list it in
  `collisions`, file stays `applied`. Same behavior day-one vs upgrade-induced.
- **Floor attributes cannot be de-emphasized:** any
  `deEmphasize` entry naming a floor attribute invalidates the whole file.
- **Caps are schema constants:** versioned with the schema.
  Byte sizes are UTF-8 byte length; boundary is inclusive (== cap is ok,
  cap+1 is over-budget). Warn at ≥ 80% of any budget.
- **Outcomes array is always length 3** in stable order
  instructions / settings / policy — one entry per fixed path, absent files
  included (`absent`, blobSha null).

## Conventions

Repo-wide rules apply (root `CLAUDE.md`): no `enum` (`as const` + `ValueOf`),
strict TS, no bare `as` (Zod / type guards at boundaries), named exports,
extensionless relative imports, `Result`/outcome values for expected
failures. `zod` is imported as `zod/v4`. Interfaces for object shapes.

## Verification

```sh
pnpm -C packages/repo-config typecheck
pnpm -C packages/repo-config test
pnpm lint                        # repo-root oxlint --type-aware
```
