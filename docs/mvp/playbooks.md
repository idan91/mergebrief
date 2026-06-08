# Playbook Library

Templated review checklists per **Category** (see `CONTEXT.md`). Items are action-shaped, mechanically checkable, category-specific, and grounded in known failure modes for that change type. Not AI hypotheses — engineering rules.

This file is the source of truth. A Change-group's dominant **Category** pulls its items here. Supporting chunks pull from the **Concern checks** section at the bottom (keyed on Concern, e.g. `test`), not from a Category — see ADR 0005 for why intent lives on the group and `test`/`config`/`generated` are Concerns, not Categories.

**Item format requirements:**
- **Action-shaped** — "Verify X" / "Check Y" / "Confirm Z", not declarative.
- **Mechanically checkable** — reviewer can answer yes/no, not "kind of".
- **Specific** — a Category playbook does not belong to another Category; a Concern check does not belong to another Concern.
- **Failure-mode-grounded** — each item encodes something that historically goes wrong with this change type.

**Status:** Category playbooks for `bugfix`, `logic-refactor`, `lib-bump`, `move-with-edits`, and opportunistic `new-feature` draft + the `test` and `doc` Concern checks. Remaining Categories (`pure-move`, `schema-change`, `dependency-update`) and Concern checks (`spec`, `config`, `generated`) drafted opportunistically as PR labeling hits them. Note: `test-only`/`config-only`/`generated-code` are NOT Categories — they are Concerns; their checks live in the Concern-checks section.

---

## `bugfix`

Failure modes this playbook is designed to catch:
- Fix targets the symptom, not the root cause.
- Regression test exists but does not actually exercise the failing path.
- Same bug pattern exists in adjacent code paths and was not fixed there.
- "Fix" suppresses or hides the bug rather than correcting it (e.g., catches and ignores an exception).
- Behavior changes unrelated to the bug are smuggled in.

Items:
- [ ] Confirm the fix addresses the root cause described in the PR title/description, not just the visible symptom.
- [ ] Identify the regression test added for this bug; confirm it actually fails on the pre-fix code.
- [ ] Check adjacent code paths (siblings of the fixed function, alternate branches, other callers) for the same bug pattern.
- [ ] Confirm no error/exception is being silently swallowed where the bug previously surfaced.
- [ ] Verify no behavior changes outside the bug's scope are included in the diff (no smuggled refactors or unrelated tweaks).

---

## `logic-refactor`

Failure modes this playbook is designed to catch:
- Claimed "behavior preserved" — actually changed under edge cases.
- Edge-case handling present in the old code dropped silently in the new.
- Performance characteristics change unexpectedly (e.g., N+1 introduced, cache invalidation order flipped).
- Tests cover the happy path but not the semantic equivalence the refactor depends on.
- A new abstraction is introduced that leaks differently than the old one.

Items:
- [ ] Identify every behavior the old code exhibited (including error paths and edge cases); confirm each one is preserved by the new code.
- [ ] Confirm tests exercise the *semantic equivalence* of the refactor (not just that the new code compiles and the happy path still works).
- [ ] Check for performance regressions implied by the refactor — algorithmic complexity, allocation patterns, sync→async boundaries, query count.
- [ ] Look for edge cases (null/empty inputs, error returns, boundary values) handled explicitly in the old code; verify the new code still handles each.
- [ ] If a new abstraction is introduced, identify what it leaks (state, errors, performance) and confirm callers handle the leaks.

---

## `new-feature`

Failure modes this playbook is designed to catch:
- New public capability lacks a clear contract, so callers infer behavior from implementation details.
- Tests cover only obvious examples and miss boundary inputs or unsupported inputs.
- Feature is added in one package/module but is not discoverable from the intended public surface.
- Existing behavior changes as a side effect of adding the new capability.
- Unsupported-input behavior is accidental rather than explicit.

Items:
- [ ] Identify the new public capability added by the diff; confirm its intended contract is clear from exported names, types, docs, or tests.
- [ ] Enumerate the main input classes for the new capability; confirm tests cover normal inputs, empty inputs, boundary values, and representative edge cases.
- [ ] Check how existing callers or consumers can discover and use the new capability without relying on private/internal paths.
- [ ] Verify the new capability composes safely with existing behavior and does not silently change unrelated code paths.
- [ ] Confirm failure or unsupported-input behavior is explicit rather than accidental.

---

## `lib-bump`

Failure modes this playbook is designed to catch:
- Breaking changes from the new version's changelog missed entirely.
- Some call sites of a changed API updated; others left at the old usage and now broken or behaving differently.
- Transitive dependencies left at the old major version (incompatible mix).
- Deprecation warnings suppressed in the diff rather than addressed.
- Implicit behavior changes (default config values, error types, return shapes) not surfaced in the PR description.

Items:
- [ ] Locate the upstream changelog for the version range being bumped; identify every breaking change listed.
- [ ] For each breaking change in the changelog, verify the diff addresses it (call site updates, config edits, removed usages).
- [ ] Sweep for every call site of the changed library/API in the repo; confirm each was visited in the diff.
- [ ] Inspect the lockfile (`package-lock.json`, `pnpm-lock.yaml`, `go.sum`, etc.) — verify no transitive dependency was left pinned to an incompatible old version.
- [ ] If deprecation warnings appear, confirm the diff fixes them rather than silencing them (`--no-warnings`, `@ts-ignore`, suppression filters).
- [ ] Check for implicit behavior changes (defaults, error types, return shapes) — these are often not in the changelog but are in the source diff or migration guide.

---

## `move-with-edits`

Failure modes this playbook is designed to catch:
- Edits hidden inside a move look like part of the move and are not reviewed as edits.
- GitHub's diff view shows a move as "delete + add" — reviewers treat both as new code and skim.
- Imports in the new location inconsistent with the rest of the file.
- References to the old location (in other files, tests, docs) not updated.
- Behavior changes wrapped in "just a move" framing in the PR description.

Items:
- [ ] Identify exactly what was moved (the bytes that should be identical between old and new location) and what was edited (bytes that differ).
- [ ] Inspect the edited portions independently of the move — treat them as a `logic-refactor` or `bugfix` chunk and apply the relevant playbook.
- [ ] Verify imports in the new location match the conventions of the new file's surrounding code (sort order, grouping, relative vs absolute).
- [ ] Sweep the rest of the repo for references to the old location (other files, tests, docs, configs); confirm each was updated.
- [ ] Verify the PR description's framing of the move is accurate — if the author says "pure move", confirm the edits portion is zero; if there are edits, confirm they are explicitly called out.

---

## Concern checks

These are NOT Category playbooks. They apply to **supporting** chunks based on their **Concern**. A bugfix group with test chunks pulls the `bugfix` Category playbook (for the carrier) plus the `test` Concern check below (for the supporting test chunks).

### `test` Concern check

Failure modes this check is designed to catch:
- Test does not actually fail on the pre-fix or pre-feature code (vacuous test).
- Test name describes a behavior the test does not exercise.
- Test passes by exercising the test infrastructure rather than the production code path.
- Flakiness — passes on the diff but is order-dependent or time-dependent.
- Coverage gap — the test exercises the *easy* path; the bug or feature lives on a different branch.

Items:
- [ ] Confirm the test fails (red) on the relevant pre-change code, and passes (green) on the changed code.
- [ ] Verify the test name accurately describes the behavior being exercised; rename if not.
- [ ] Confirm the test exercises the production code path, not just mocks or setup code (no "tests the mock" anti-pattern).
- [ ] Check the test for ordering, timing, or external-state dependencies that could cause flakiness.
- [ ] Identify the branch / code path the test covers; confirm it is the path most likely to break (not the easy happy path while the bug lives on the error path).

### `doc` Concern check

Failure modes this check is designed to catch:
- Doc/update claims behavior that differs from the implementation.
- Package names, exported symbols, version notes, or public API references drift from the changed code.
- Release-note phrasing over-promises support for behavior not covered by implementation or tests.

Items:
- [ ] Confirm the doc/update accurately describes the behavior introduced by the carrier chunks.
- [ ] Check that names, package scopes, version notes, and public API references match the implementation exactly.
- [ ] Verify the doc/update does not promise behavior that is not covered by implementation or tests.
