# Archive: FE condensed Playbook items (removed 2026-07)

Frozen copy of `apps/web/src/features/brief/playbooks.ts` as deleted by the
BRIEF-6 playbook park (ADR 0035, PR #145) — kept so the exact FE wording is
findable without git archaeology.

Context: the *source of truth* for playbook content is `docs/mvp/playbooks.md`
(parked in place, richer items + failure-mode lists). This file preserves only
the FE's condensed variants, which were semantically identical but terser; the
FE rendered nothing from them at removal time (`CATEGORY_PLAYBOOKS` had zero
imports; `CONCERN_CHECKS` only gated concern visibility). The removed check-off
spine (`CheckBucket`, `checkedItems`, `checkPlaybookItem`, progress counters,
snapshot field) is reconstructable from PR #145's diff if v2 ever wants it as a
sketch — ADR 0035 says rebuild deliberately, not resurrect.

## Category playbooks (`CATEGORY_PLAYBOOKS`)

### `bugfix`

- Confirm the fix addresses the root cause described in the PR title/description, not just the visible symptom.
- Identify the regression test added for this bug; confirm it actually fails on the pre-fix code.
- Check adjacent code paths (siblings of the fixed function, alternate branches, other callers) for the same bug pattern.
- Confirm no error/exception is being silently swallowed where the bug previously surfaced.
- Verify no behavior changes outside the bug's scope are included in the diff (no smuggled refactors or unrelated tweaks).

### `logic-refactor`

- Identify every behavior the old code exhibited, including error paths and edge cases; confirm each one is preserved.
- Confirm tests exercise the semantic equivalence of the refactor, not just that the new code compiles.
- Check for performance regressions implied by the refactor: complexity, allocation, sync/async boundaries, or query count.
- Look for edge cases handled explicitly in the old code; verify the new code still handles each.
- If a new abstraction is introduced, identify what it leaks and confirm callers handle those leaks.

### `new-feature`

- Identify the new public capability added by the diff; confirm its intended contract is clear from exported names, types, docs, or tests.
- Enumerate the main input classes for the new capability; confirm tests cover normal inputs, empty inputs, boundary values, and representative edge cases.
- Check how existing callers or consumers can discover and use the new capability without relying on private/internal paths.
- Verify the new capability composes safely with existing behavior and does not silently change unrelated code paths.
- Confirm failure or unsupported-input behavior is explicit rather than accidental.

### `lib-bump`

- Locate the upstream changelog for the version range being bumped; identify every breaking change listed.
- For each breaking change in the changelog, verify the diff addresses it.
- Sweep for every call site of the changed library/API in the repo; confirm each was visited.
- Inspect the lockfile and verify no transitive dependency was left pinned to an incompatible old version.
- Confirm deprecation warnings are fixed rather than silenced.
- Check for implicit behavior changes: defaults, error types, and return shapes.

### `move-with-edits`

- Identify exactly what was moved and what was edited.
- Inspect edited portions independently of the move and apply the relevant category playbook.
- Verify imports in the new location match local conventions.
- Sweep the repo for references to the old location and confirm each was updated.
- Verify the PR description accurately frames the move/edit split.

### `pure-move`

- Confirm moved bytes are identical between old and new locations.
- Verify imports and exports were updated everywhere the moved code is referenced.
- Confirm tests, docs, and build config point at the new location.

### `dependency-update`

- Confirm the dependency update has no documented API or behavior impact.
- Check the lockfile for a consistent dependency graph.
- Verify touched call sites are incidental rather than migration work.

### `schema-change`

- Identify every schema contract changed by the diff.
- Confirm migration, backfill, and rollback expectations are explicit.
- Check downstream consumers for compatibility with the new shape.

## Concern checks (`CONCERN_CHECKS`)

### `test`

- Confirm the test fails on the relevant pre-change code and passes on the changed code.
- Verify the test name accurately describes the behavior being exercised.
- Confirm the test exercises the production code path, not just mocks or setup code.
- Check the test for ordering, timing, or external-state dependencies that could cause flakiness.
- Identify the branch or code path the test covers; confirm it is the path most likely to break.

### `doc`

- Confirm the doc/update accurately describes the behavior introduced by the carrier chunks.
- Check that names, package scopes, version notes, and public API references match the implementation exactly.
- Verify the doc/update does not promise behavior that is not covered by implementation or tests.

### `spec`

- Confirm the spec describes the same contract the implementation now enforces.
- Check that examples and terminology match the changed code.

### `config`

- Confirm configuration changes are scoped to this PR's intent.
- Check local and CI environments receive compatible defaults.

### `generated`

- Confirm generated output corresponds to an intentional source change.

