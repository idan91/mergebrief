# packages/repo-config: agent notes

The `.mergebrief/` repo-local config surface. Turns raw file contents (server-fetched from the default branch, or CLI working-tree reads later) into a validated, budget-checked config the generator consumes. This package is **pure and source-agnostic**: it never fetches, never touches the filesystem, never talks to GitHub. It takes strings in and returns outcomes.

Repo-wide conventions apply (root AGENTS.md); refinements below.

## Map

- `validateRepoConfig(input)` (`validate.ts`) is the consumer-facing contract.
- `schemas.ts` is `.strict()` everywhere; its attribute-name charset is a security control (names later extend a model json_schema enum). The `tracker:` block takes its schemas from `generators/trackers` and the `triggerConditions:` block from `generators/trigger-conditions`, the only parts of `generators` this package may import.
- Budget caps in `constants.ts` are schema constants, versioned with the schema. It is also the `repo-config/constants` subpath, the only part of this package a browser bundle imports: it reaches the `types` package and nothing else, and `web-source-reaches-no-yaml-reader` fails if apps/web reaches the YAML reader through the entry.

## Invariants (enforced, don't weaken)

- **Reject-whole:** a file that fails parse / schema / caps contributes NOTHING, never partial use. Outcome `invalid` or `over-budget`; generation proceeds without it (caller's concern).
- **Secret/echo hygiene:** outcome `detail`/`warning` strings carry `path` + a sanitized reason ONLY. Never echo file content, YAML values, secrets, or raw `yaml`-lib parse messages (they can quote source). Zod issue paths/codes are fine; `received` values are NOT.
- **Built-in vocabulary is imported, never duplicated:** `RiskSurfaceAttributes` comes from `brief-core/types`. Collisions (custom name ∈ built-in ∪ parked ∪ reserved) fail TOWARD built-in semantics: drop the custom def, list it in `collisions`, file stays `applied`. Same behavior day-one vs upgrade-induced.
- **Floor attributes cannot be de-emphasized:** any `deEmphasize` entry naming a floor attribute invalidates the whole file.
- **Caps are schema constants:** versioned with the schema. Byte sizes are UTF-8 byte length; boundary is inclusive (== cap is ok, cap+1 is over-budget). Warn at ≥ 80% of any budget.
- **Outcomes array is always length 3** in stable order instructions / settings / policy, one entry per fixed path, absent files included (`absent`, blobSha null).
