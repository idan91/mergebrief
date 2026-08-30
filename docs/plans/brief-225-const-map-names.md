# Plan — BRIEF-225: PascalCase plural `as const` maps

> Status: ready to implement.
> Ticket: [BRIEF-225](https://app.notion.com/p/3c55e9400eeb81a78f61dcf8e96b7fc6)
> Origin: PR 401 review of the BRIEF-202 chain (`API_ERROR_STATUS` reads like a
> plain constant, not a vocabulary).

## What this delivers

One naming convention for enum-like `as const` maps, matching root `AGENTS.md`:

- Map **names** are PascalCase and **plural**.
- The `ValueOf` **type** is singular.
- Keys stay SHOUT_CASE; string values stay kebab-case.
- 1:1 lookup tables (not vocabularies) become PascalCase **table** names, not
  forced plurals: `OutcomeToEvent`, `SideOnGithub`, `ApiErrorStatusByCode`,
  `ApiErrorEnglishByCode`.

Compile-time names only. Wire JSON, status codes, kebab values, and
`manifest:check` bytes do not move. Frozen wire suites may change **imports and
identifier names**; they must not change asserted response bodies.

## Git requirements (`git-eng` — mandatory for all git operations)

Use the `git-eng` skill for every branch, commit, push, and PR. Do not
improvise git/gh flow.

- Stacked branches off `main`, git-eng shape `type/TICKET/slug`:
  `chore/BRIEF-225/<slug>`. PR 1 targets `main`; later PRs target the previous
  branch. HTTPS + gh credential helper.
- Agent **commits**, **chunked** (one vocabulary cluster per commit inside a PR).
- No `Co-Authored-By` trailers, no AI attribution in commits or PR bodies.
- Pre-commit review agents: **none**.
- PR titles: `[BRIEF-225] chore: <Title Case>`. No template in repo — Overview /
  Changelog shape.
- **One session, full stack.** Do not stop after PR 1 or wait for review
  between PRs. After each PR's commits: `git push -u origin HEAD` and
  `gh pr create` (ready for review, not draft). PR 1 `--base main`; later PRs
  `--base` the previous branch. Owner reviews the stack when all four are up.
  Do not merge.

## Specialist skills (mandatory — user-confirmed)

- `typescript-eng` — every part.
- `verify` — after the last PR (lint, typecheck, tests for changed packages +
  dependents, `manifest:check`). Judge gates by exit code, not grepped output.
- `tdd` is **not** in scope (rename/refactor; no new behavior).

## Decisions

| # | Decision |
|---|----------|
| Sweep depth | **Full plural.** Every `as const` + `ValueOf` vocabulary map: plural const, singular type. Already-plural maps (`LogLevels`, `ApiErrorCodes`, `ProductActionIds`, `PullRequestSources`, …) stay. |
| Lookups | PascalCase table names. Not vocabularies. |
| Cross-package | **Staged re-exports**, not one mega-PR. Persistence (and any other public barrel) keeps a same-identifier alias for one PR so dependents compile, then consumers migrate, then aliases die. |
| Wire | Values and HTTP bodies unchanged. `error-response.test.ts` / i18n pin / web `Equals` mirrors update **names only**. |
| Eval harness | Not touched. Stop if a sweep would change generation-surface semantics. |
| Run | One session through all four PRs. Push and open each PR as it finishes. No mid-stack review pause. |

### Rename rules (apply mechanically)

**Vocabulary** (`ValueOf<typeof Map>` is a closed set of tokens):

```ts
export const PrStates = { OPEN: "open", /* … */ } as const;
export type PrState = ValueOf<typeof PrStates>;
```

Call sites: `PrStates.OPEN`. Type annotations stay `PrState`.

`*ErrorCode` maps follow the same pattern: const `GitHubApiErrorCodes`, type
`GitHubApiErrorCode`. `packages/api`'s `ApiErrorCodes` already matches.

**Lookup** (key → something else, not the thing being enumerated):

| Current | New |
|---|---|
| `API_ERROR_STATUS` | `ApiErrorStatusByCode` |
| `API_ERROR_ENGLISH` | `ApiErrorEnglishByCode` |
| `WRITE_CLASSIFICATION` | drop the alias; import `WriteClassifications` |
| `OPERATION_KIND` | `OperationKinds` |
| `OUTCOME_TO_EVENT` | `OutcomeToEvent` |
| `SIDE_ON_GITHUB` | `SideOnGithub` |
| `SEAL_REASON` | `SealReasons` (it *is* a vocabulary) |
| `SCOPE_RANK` | `ScopeRanks` |
| `KIND_FOR_CODE` (web) | `KindForCode` |
| `CLEARED_BY` | `ClearedBy` |

Do **not** rename fixtures, `NO_STORE`, probe objects, copy-key maps, or
`RESOURCES` / `GENERATOR_REGISTRY` unless they grow a `ValueOf` vocabulary.

## Sequencing — 4 stacked PRs

Ideal <500 changed LOC, ceiling ~1,000. Measure `git diff --stat <base>` after
each part-commit; if a PR blows the ceiling, split along the split trigger.

| # | Branch | Contents | Est. diff LOC | Split trigger |
|---|---|---|---|---|
| 1 | `chore/BRIEF-225/01-persistence-maps` | `packages/persistence/src/types.ts` + in-package callers/tests/AGENTS.md. Public barrel: `export const PrState = PrStates` (and the same for every renamed map) so api/cli/worker/web still compile. | ~600–900 | >1,000 → leave tests on aliases, migrate tests in 1b |
| 2 | `chore/BRIEF-225/02-api-i18n` | api vocabularies + lookups (`WriteClassifications`, `ApiErrorStatusByCode`, `ApiErrorEnglishByCode`, `OperationKinds`, `AuthChannels`, `RefreshErrorCodes`, `SealReasons`, `OutcomeToEvent`, `SideOnGithub`, …). `packages/api/AGENTS.md` recipe. `packages/i18n/test/wire-pin.test.ts`. Barrel exports in `packages/api/src/index.ts`. | ~700–1,000 | product-operations route `index.ts` classification sites overflow → 2b |
| 3 | `chore/BRIEF-225/03-other-packages` | `github`, `worker`, `generators`, `repo-config`, `logging` (already `LogLevels`), `cli`, `tools/ingest-briefs`. Error-code maps to `*ErrorCodes`. | ~500–900 | github `GitHubApiErrorCode` + webhook maps overflow → github-only 3a, rest 3b |
| 4 | `chore/BRIEF-225/04-web-and-drop-aliases` | `apps/web` maps that are still singular (`ApiErrorCode`, `BriefErrorCode`, `GenerateErrorCode`, `TokenScope`, `ExpiryChoice`, `LastReviewUnavailableReason` in api if not done). Align web mirrors that are **already** plural (`PrStates`, `GenerationStatuses`, `GenerationFailureCodes`) so they import/use persistence names after aliases die. **Final commit: delete every staged alias.** Root/package AGENTS examples that still show `const PrState`. Living docs that name old exports; ADR 0041 gets a parenthetical current name, not a rewrite. | ~400–800 | alias-drop in its own PR 4b if web alone is large |

Order is fixed (each PR builds on the previous). PR 1's aliases are the only
reason later PRs can land independently of a single compile.

### Persistence maps to pluralize (PR 1)

Already plural: `PullRequestSources`.

| Const today | Const after | Type (unchanged) |
|---|---|---|
| `PrState` | `PrStates` | `PrState` |
| `DispositionDecision` | `DispositionDecisions` | `DispositionDecision` |
| `DispositionCarryStatus` | `DispositionCarryStatuses` | `DispositionCarryStatus` |
| `DispositionEvidenceStatus` | `DispositionEvidenceStatuses` | `DispositionEvidenceStatus` |
| `DispositionEvidenceKind` | `DispositionEvidenceKinds` | `DispositionEvidenceKind` |
| `WriteClassification` | `WriteClassifications` | `WriteClassification` |
| `GenerationKind` | `GenerationKinds` | `GenerationKind` |
| `GenerationStatus` | `GenerationStatuses` | `GenerationStatus` |
| `GenerationPhase` | `GenerationPhases` | `GenerationPhase` |
| `GenerationFailureCode` | `GenerationFailureCodes` | `GenerationFailureCode` |
| `AuditActorType` | `AuditActorTypes` | `AuditActorType` |
| `AuditChannel` | `AuditChannels` | `AuditChannel` |
| `AuditOutcome` | `AuditOutcomes` | `AuditOutcome` |
| `ReviewOutcome` | `ReviewOutcomes` | `ReviewOutcome` |
| `DraftCommentStatus` | `DraftCommentStatuses` | `DraftCommentStatus` |
| `DraftCommentSide` | `DraftCommentSides` | `DraftCommentSide` |
| `AnchorStatus` | `AnchorStatuses` | `AnchorStatus` |
| `ChangeGroupCategory` | `ChangeGroupCategories` | `ChangeGroupCategory` |

Store-local `*ErrorCode` maps in the same package (`IngestErrorCode`,
`GenerationErrorCode`, `PurgeErrorCode`, …) migrate in PR 1 with the types
file, chunked by folder (`types` / `auth` / `stores` / `db`).

Alias shape (public only, deleted in PR 4):

```ts
export const PrStates = { /* … */ } as const;
export type PrState = ValueOf<typeof PrStates>;
export const PrState = PrStates;
```

No ticket ids in source comments. Aliases last until PR 4's drop commit. The
plan and PR body carry BRIEF-225.

## Model / effort / invocation per part

| Part | Model + effort | Invocation |
|---|---|---|
| PR 1 (declaration + aliases; easy to get the ValueOf/const split wrong) | high-capability, medium | Main thread |
| PRs 2–4 (mechanical identifier sweep) | medium | Main thread, sequential (stack) |
| `verify` | — | Main thread, after PR 4 |

No subagents unless a PR's file list is so wide that a search pass helps; the
renames themselves stay in the main thread so identifier pairs do not drift.

## Implementation steps (every PR)

1. `git-eng`: branch from the previous tip (or `main` for PR 1).
2. Inventory remaining violations in that PR's packages (`export const` +
   `ValueOf`, plus SHOUT_CASE maps named in this plan). Do not trust this table
   as complete.
3. Rename declaration, then references, then tests. One cluster per commit.
4. Update AGENTS/recipe/docs in the same PR that changes the export those docs
   name.
5. Gates: `pnpm -C <pkg> typecheck`, `pnpm -C <pkg> test`, dependents that
   import the renamed symbols, `pnpm -C packages/api manifest:check` when api
   moves. `pnpm lint` from root before push. Never lower a coverage floor.
6. Commit via `git-eng` (chunked). Push and open the PR immediately, then
   branch the next PR from this tip. After PR 4: `verify` on the stack tip,
   then stop. Do not ask between PRs. Do not merge.

## Out of scope

- Changing kebab values, HTTP statuses, or i18n **strings**.
- Adding oxlint/ESLint enforcement of map-name shape (nice follow-up; this
  ticket is the rename).
- Generation prompt/eval surface.
- Rewriting ADR rationale; only current-name pointers where a living recipe
  still says `API_ERROR_STATUS`.
