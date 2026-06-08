# Phase 1 Brief: add string case conversion utilities

**PR:** https://github.com/better-auth/better-auth/pull/9727
**Repo:** better-auth/better-auth
**Size (git):** 6 files, +125/−17

> What it does (plain): add Unicode-aware `toCamelCase / toSnakeCase / toPascalCase / toKebabCase` helpers to `@better-auth/core/utils/string`, then replace three inline regex implementations across the codebase with the shared helpers.

---

## 1. Chunk Inventory

| Chunk | Suggested Concern | Suggested Role | Group # | Weighted LoC | Risk Surface |
|---|---|---|---|---|---|
| `packages/core/src/utils/string.ts` (+37) · (+) 4-40 · (−) — | implementation | carrier | 1 | +30/−0 | widely-imported |
| `packages/core/src/utils/string.test.ts` (+77) · (+) 1-77 · (−) — | test | supporting | 1 | +50/−0 | N/A |
| `packages/better-auth/src/client/proxy.ts` (+2/−7) · (+) 6, 71 · (−) 70-76 | implementation | carrier | 1 | +1/−0 | touches-auth, hot-path |
| `packages/better-auth/src/plugins/open-api/generator.ts` (+2/−2) · (+) 7, 430 · (−) 7, 430 | implementation | carrier | 1 | +1/−0 | cross-service |
| `packages/cli/src/generators/drizzle.ts` (+2/−8) · (+) 2, 11 · (−) 10-17 | implementation | carrier | 1 | +1/−7 | schema-adjacent |
| `.changeset/string-case-utils.md` (+5) · (+) 1-5 · (−) — | doc | supporting | 1 | +2/−0 | N/A |

> The 3 small `−7/−8/−2` chunks are call sites swapping an inline regex for the new shared helper. They are a `logic-refactor` (dedup), riding on the new-feature carrier.

## 2. Change-groups (Story View)

### Group 1: Add shared string case conversion utilities

**Categorization:** dominant: `new-feature` · secondary: [`logic-refactor`]
**Summary:** Added shared Unicode-aware string case conversion helpers and replaced inline case-conversion logic in the client proxy, Drizzle generator, and OpenAPI generator.
**Carrier chunks:** `packages/core/src/utils/string.ts`; `packages/better-auth/src/client/proxy.ts`; `packages/better-auth/src/plugins/open-api/generator.ts`; `packages/cli/src/generators/drizzle.ts`
**Supporting chunks:** `packages/core/src/utils/string.test.ts`; `.changeset/string-case-utils.md`
**Attention-weighted LoC:** +85/−7

**Playbook (copy from `../playbooks.md` for dominant Category + supporting-Concern checks):**
- [ ] Identify the new public capability added by the diff; confirm its intended contract is clear from exported names, types, docs, or tests.
- [ ] Enumerate the main input classes for the new capability; confirm tests cover normal inputs, empty inputs, boundary values, and representative edge cases.
- [ ] Check how existing callers or consumers can discover and use the new capability without relying on private/internal paths.
- [ ] Verify the new capability composes safely with existing behavior and does not silently change unrelated code paths.
- [ ] Confirm failure or unsupported-input behavior is explicit rather than accidental.
- [ ] Confirm the test fails (red) on the relevant pre-change code, and passes (green) on the changed code.
- [ ] Verify the test name accurately describes the behavior being exercised; rename if not.
- [ ] Confirm the test exercises the production code path, not just mocks or setup code (no "tests the mock" anti-pattern).
- [ ] Check the test for ordering, timing, or external-state dependencies that could cause flakiness.
- [ ] Identify the branch / code path the test covers; confirm it is the path most likely to break (not the easy happy path while the bug lives on the error path).
- [ ] Confirm the doc/update accurately describes the behavior introduced by the carrier chunks.
- [ ] Check that names, package scopes, version notes, and public API references match the implementation exactly.
- [ ] Verify the doc/update does not promise behavior that is not covered by implementation or tests.

## 3. Concern View (LoC Split)

| Concern | Weighted LoC | Notes |
|---|---|---|
| implementation | +33/−7 | new shared util + 3 call-site replacements |
| test | +50/−0 | string.test.ts covers existing `capitalizeFirstLetter` plus new case helpers |
| doc | +2/−0 | changeset |
| spec | +0/−0 | |
| config | +0/−0 | |
| generated | (collapsed) | |

## 4. Tricky-Cases Note

> Pre-register BEFORE sessions. Freeze. Each = observable, gradable.

1. The three replaced call sites are not behavior-equivalent by default: `toKebabCase` changes acronym handling in client routes (`URLPath` becomes `url-path` instead of `-u-r-l-path`), `toSnakeCase` may change Unicode/apostrophe handling in Drizzle field names, and `toPascalCase(method)` changes operationId suffix normalization for non-lowercase method strings.
2. The shared `splitWords` regex is now a widely imported utility contract; a reviewer should verify acronym, number, apostrophe, separator, and Unicode letter cases rather than only ASCII camel/snake examples.
3. The new tests cover representative cases for `toSnakeCase`, `toKebabCase`, `toCamelCase`, and `toPascalCase`, but a reviewer should check whether unsupported punctuation/separator inputs and non-Latin scripts are intentionally handled or accidentally dropped.
4. The dedup sweep is partial by construction: the PR replaces three inline conversions, so a reviewer should search for adjacent case-conversion regexes before assuming this centralizes all string case behavior.

## Labeling Scratch

- Single group. The utility implementation, call-site replacements, tests, and changeset all fit one summary: add shared string case helpers and adopt them at existing inline conversion sites. Test/doc chunks are supporting, not independent groups.
- Cold diff and PR description match: both frame this as adding Unicode-aware case helpers and replacing three inline regex implementations.
- `new-feature` is dominant because the public core utility exports are the new capability; `logic-refactor` is secondary because the call-site changes deduplicate existing inline conversions.
