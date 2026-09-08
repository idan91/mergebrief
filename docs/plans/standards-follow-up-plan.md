# Standards follow-up implementation plan

Prepared on 2026-09-06 from the stack review and the owner's subsequent decisions.

## Scope and stopping point

This session writes an **uncommitted plan only**. Implementation, commits, PR publication, tracker changes, merging and branch deletion are separate phases. Leave the existing [U0 plan](u0-standards-plan.md) untouched and do not change the current checkout to save this file.

The work has two stages: correct the existing U0 stack under its accepted requirements, then build one sequential follow-up stack after U0 is integrated. Follow-ups make standards reward cohesion, exercise the real enforcement configuration, and improve a small number of concrete ownership boundaries. They do not authorize implementing the entire release backlog.

Sources:

- [U0 decision map](https://app.notion.com/p/3d25e9400eeb81b7bd4bf028cc2b458e), [U0 ticket](https://app.notion.com/p/3d25e9400eeb819aaac1ff4d9c7939e4), and the local U0 plan.
- [Release backlog and dependencies](https://app.notion.com/p/3d25e9400eeb81b1982ed359075ef72e) and [workspace boundary decision](https://app.notion.com/p/3d25e9400eeb8167801fcecad03f6476).
- The four inline findings linked below and the decisions recorded in this document. These newly accepted policy changes deliberately supersede the corresponding U0 rules only when their follow-up PR lands.

## Accepted decisions

1. Type-count extraction thresholds and the closed support-filename list become **reviewer-held defaults with justified exceptions**. Cohesion decides whether code belongs together. A count is a review signal, not sufficient reason to split a file.
2. Comment length becomes reviewer-held. Remove the comment-run error gate. Preserve useful constraints and rationale the code cannot express. Test-title limits and the em-dash rules remain unchanged.
3. All later improvement PRs form **one sequential stack**, starting after the U0 fixes are integrated. External ticket prerequisites can pause that stack; they do not authorize a parallel stack or unrelated implementation.
4. Future implementation retains U0's workflow: logical commits, security and performance reviews before every commit, and ready-for-review PRs. The owner handles merging and branch deletion.
5. Prefer explicit domain ownership and small public interfaces. Avoid generic optional-field builders, one-helper-per-file decomposition, and tests coupled to private helper names.

## Baseline and preflight

The reviewed stack is PRs 477 through 487, from base `30f5e360f84c0a2a8ea99dd4f80cc606c0af1998` through tip `fbf82bbf9d18c4a452e4523ac0a2a6b120de46bc`. At the planning refresh, all eleven PRs remained open and the four review threads remained unresolved. Re-fetch before implementation; these are observations, not durable assumptions.

The local checkout while writing this plan is `chore/BRIEF-256/lint-7-depth-hooks-env`, HEAD `6685648d0f534d1c5b1acf65d17e6ba47fabc8ba`. Later stack changes must be inspected at their own heads. Do not mistake the current checkout for the reviewed tip.

Prior review verification at the tip: lint and web build passed; selected generators, brief-core, worker and web suites reported 3,057 passing tests. Recursive typecheck had the already-existing `ParseWarnSink` / `ParseWarnings` mismatch at `apps/web/src/features/brief/utils/validation.test.ts:403`. These results are evidence from the review, not verification of future edits. Track the existing typecheck failure through its owner; do not quietly count a failing command as green.

Before implementation, inspect status and worktrees, preserve unrelated changes and both uncommitted plans, refresh PR heads and ticket dependencies, and record the actual starting checks. Never stash foreign work. Read applicable member instructions before editing. Search source paths explicitly; never search or read real environment files, particularly `tools/categorizer/.env`.

## Mandatory workflow and skills

Use `git-eng` explicitly for **all git operations during implementation**.

- Correct existing PRs at the earliest branch that owns the issue, then realign descendants and lint every affected branch bottom-up. Verify ancestry before realignment, including after squash merges. Do not assume the tip passing proves intermediate branches pass.
- Use logical commits. Before each commit, give the staged diff to parallel security and performance reviewers. Fix findings at confidence 80 or above and re-review before committing. Use the two review roles required by U0; verify their availability when implementation starts rather than claiming a review that did not run.
- Use the minimum other delegation. Implementation is sequential in the main thread. The required pre-commit reviews and inherited PR review lifecycle are the explicit exceptions.
- The first follow-up branch starts from main containing integrated U0 fixes. Each subsequent branch starts from its predecessor; its PR targets that predecessor. Retarget as the owner merges, preserving the same logical sequence.
- Publish ready-for-review PRs via `gh`, with `[TICKET_CODE] <prefix>: <Title Case>` titles using the existing owning ticket. Bodies describe the final behavior, relevant validation, dependencies and any limitations. Follow the current repository template, or Overview and Changelog if none exists. Retain U0's prose cleanup pass; include screenshots only when useful and available. No AI attribution or co-author trailers.
- Retain U0's PR review lifecycle: one review agent per PR, at most two rounds, medium-and-above findings, fixes upstream first. A finding requires a sweep of the whole affected stack before replying. Explain findings believed incorrect rather than applying compliance edits.
- Judge commands by exit status. Keep coverage floors, and run affected packages plus dependents. Agreements absent from the workspace graph require explicit local verification.
- Merging and branch deletion remain with the owner. Never invoke the paid generation eval harness as an agent.

Confirmed specialist skills are mandatory within these scopes:

| Skill | Scope |
| --- | --- |
| `typescript-eng` | TypeScript and tooling changes; repository conventions override generic tool defaults. |
| `codebase-design` | Ownership, public interfaces and cohesion in matcher, modal and worker changes. |
| `tdd` | New enforcement behavior and uncovered public behavior; confirm the specific test seams before writing tests. Reuse adequate existing coverage. |
| `vercel-react-best-practices` | Modal render and state behavior, applying React guidance appropriate to this TanStack app. |
| `web-accessibility` | Modal focus, keyboard interaction, announcements and accessible names. |

`init-plan` governs this planning artifact. Specialist approval is not permission to implement during this session. Future seam confirmation required by `tdd` remains an implementation checkpoint.

## Stage A: repair the existing U0 stack

Keep acceptance fixes separate from the later policy change. A documentation change must not be presented as a fix for an enforcement defect under the currently accepted policy.

### A1. Enforce fixed package layers

Owner: [PR 480 finding](https://github.com/Idan91/code-review/pull/480#discussion_r3943209232). Approximately 150–300 changed lines including regression coverage.

1. Add explicit forbidden edges to `.dependency-cruiser.cjs` independent of manifest-derived allowed dependencies: `types` imports no workspace package; `logging`, `i18n` and `generators` import only `types`.
2. Preserve generated declared-dependency checks, application boundaries and feature restrictions. Do not extend known violations to absorb forbidden new edges.
3. Prove with an isolated fixture using the real config that adding a forbidden dependency to a manifest still fails, and a permitted dependency passes. Include type-only imports and subpath resolution where supported by the actual graph.
4. Run the boundary gate and affected lint at this branch and its descendants.

Recommendation: `gpt-6-astra`, high effort, sequential main thread. The defect concerns two overlapping sources of dependency policy.

### A2. Complete cleanup-on-edit across the stack

Owner: [PR 482 finding](https://github.com/Idan91/code-review/pull/482#discussion_r3943209256), with fixes placed at each owning PR. This is a multi-commit sweep, not a small suppression-file edit.

The review counted 171 subsequently edited baselined files retaining 2,053 title/comment suppressions after the baseline PR. The initial app moves were excluded. Largest groups were web (78 files, 604 suppressions), api (19, 414), generators (21, 241), brief-core (11, 227), and worker (5, 208). Recompute from refreshed heads before assigning batches; counts describe debt, not estimated changed lines.

1. Inventory baseline entries by rule, member and earliest post-baseline editing PR. Respect the existing rule-specific cleanup-on-edit requirement; do not burn untouched repository-wide debt here.
2. Correct title and em-dash violations without erasing useful test distinctions or constraints. For long constraints that cannot be shortened responsibly under the interim rule, use an explicit, narrowly scoped, reasoned local exception permitted by the existing policy. Do not convert useful explanations into cryptic one-liners solely to make a count pass.
3. Prune the affected suppressions and verify each edited file under the applicable rules without its old baseline entries. Record any justified local exceptions separately so they do not masquerade as debt removed.
4. Batch by owning PR and member, targeting 200–500 human-edited lines per logical commit. Split larger members further. Report generated baseline churn separately; do not invent a source-size estimate from suppression counts. Avoid adding unrelated standalone cleanup PRs into the existing stack.
5. Lint bottom-up after each owning branch is corrected. Reconcile the final inventory before replying to the thread. Retiring comment length in F1 is a separate policy decision, not evidence that this original cleanup requirement was met.

Recommendation: `gpt-5.6-sol`, medium effort, sequential main thread, escalating ambiguous constraint edits to high effort. No new behavior tests for punctuation-only changes.

### A3. Supply generation-surface evidence

Owner: [PR 485 finding](https://github.com/Idan91/code-review/pull/485#discussion_r3943209299). Evidence-only work where existing fixtures suffice; allow a separate logical 100–250-line fixture change in the owning PR if needed.

1. Correct the claim that generation surfaces were untouched. Inventory validator, salvage and repo-config injection changes against the originating base and explain intended behavioral equivalence.
2. Prepare a **full-suite** case selection and justification for shared validation/salvage changes, following `tools/categorizer/eval/README.md`. Shared salvage can affect every property; a convenient small subset is insufficient evidence. The human runs the harness and supplies reports. Do not run it, spend, or rebaseline as an agent.
3. State the coverage limitation: none of the inspected 13 single-case fixtures or 11 revision-pair fixtures supplies `repoContext`. Running all of them does not validate that injection path. Inspect existing deterministic budget, fence and glob coverage, then prepare a bounded repo-context fixture with meaningful output predicates for uncovered behavior. Validate its predicates deterministically before requesting a human generation run.
4. Distinguish baseline comparisons from new or otherwise unbaselined cases. A report without a baseline is not a passing regression comparison. Preserve each report, since sequential runs may overwrite output. For any scoped extra case, use one `--case <id>` per invocation.
5. Attach the human's reports, case rationale, deterministic results and limitations to the PR. If the human run is pending, leave this acceptance item pending. Rebaseline only on main for a legitimate surface change, never to erase unexplained regressions.

Recommendation: `gpt-6-astra`, high effort, sequential main thread for preparation; human-only harness execution is a stopping point.

### A4. Cover plural logic in TypeScript helpers

Owner: [PR 486 finding](https://github.com/Idan91/code-review/pull/486#discussion_r3943209326). Approximately 100–200 changed lines.

1. Extend the intended `house/no-hand-built-plural` override from TSX to both TS and TSX across the relevant web source paths.
2. Preserve the deliberate non-catalog receipt-text exception. Sweep newly covered helpers and use their owning catalog keys where the rule applies.
3. Run identical violating examples through the real root configuration at representative `.ts` and `.tsx` paths; both must fail. Check a legitimate catalog use and the narrowly documented exception pass.
4. Run catalog validation, relevant tests and lint bottom-up.

Recommendation: `gpt-5.6-sol`, medium effort, sequential main thread.

**Stage A exit:** all four findings have concrete fixes/evidence and stack-wide sweeps, no unexplained new check failures, and the owner has integrated U0. Human eval evidence cannot be inferred from passing unit tests. Start Stage B only after this boundary.

## Stage B: one sequential follow-up stack

Use the following order. Target fewer than 500 changed lines per PR; about 1,000 is a reviewability guideline, not a reason to create incoherent modules. Estimates include added and deleted lines, including moves. Split at the stated boundaries when a measured diff exceeds the useful review size.

| Order | Deliverable and existing ownership | Estimated changed lines | Model / effort / invocation |
| --- | --- | --- | --- |
| F1 | Policy clarification and comment-run retirement; standards and documentation owners | 200–400 human-edited, plus generated baseline removals | `gpt-5.6-sol`, medium, sequential main thread |
| F2 | Real-configuration contract suite; standards tooling, coordinated with U12 | 250–450 | `gpt-6-astra`, high, sequential main thread |
| F3 | Browser-safe glob matcher ownership; scoped U24 work | 350–650 including moves | `gpt-6-astra`, high, sequential main thread |
| F4 | SubmitModal view cohesion; scoped U28 pilot | 450–800 including moves | `gpt-6-astra`, high, sequential main thread |
| F5a | Worker anchoring contract coverage, only where missing; scoped U23 pilot | 150–300 | `gpt-6-astra`, high, sequential main thread |
| F5b | Worker anchoring ownership extraction; scoped U23 pilot | 500–900 including moves | `gpt-6-astra`, high, sequential main thread |

Model names are recommendations for future sessions, not claims about reviewers already run. When changing the recommended model, continue sequentially with the saved plan and exact preceding head. F5a can be folded into F5b if existing coverage is already sufficient and the combined diff stays reviewable; do not create a tests-only PR that adds no protection.

### F1. Make policy express the intended judgment

- Update root `AGENTS.md` and any affected member refinements. Explicitly separate enforced constraints, reviewer guidance and migration debt. Preserve the canonical-owner rule and paired `CLAUDE.md` pointers.
- Describe type-count thresholds and conventional support names as defaults. Permit a cohesive domain-specific filename or colocated types when that makes ownership clearer. Review asks what changes together and what callers need to understand. Justify material exceptions in the PR, avoiding boilerplate comments throughout source.
- Keep package boundaries, import/export restrictions, casing and other unaffected standards intact. This decision does not soften every file-shape rule or authorize mass renames. Interpret decomposition guidance through cohesion without inventing new numeric caps.
- Replace the comment-length defect claim with guidance to explain non-obvious constraints concisely at the relevant owner. Remove `house/comment-run` from root configuration, plugin registration, implementation, dedicated tests/fixtures, suppression data and obsolete local disables. Keep shared fixtures still needed by other rules.
- Keep test-title and em-dash errors and their baselines. Preserve the house tool's coverage floor. Report baseline entries retired by policy separately from actual violations corrected.
- Add a compact review checklist and debt register to an appropriate existing standards document: owner, measurable remaining entries or boundaries, prerequisite and closure evidence. Keep ticket links in the PR body or this uncommitted plan, consistent with tracked-file provenance rules.

Done when documentation and actual configuration agree, useful long comments pass without comment-run exceptions, remaining title/em-dash violations still fail, and plugin tests, coverage, lint and formatting pass. No code reshaping just to demonstrate the softened rule.

### F2. Test the configuration users actually run

Extend the existing house-tool test infrastructure; its fixture-only rule tests do not prove root override coverage. Reuse the real-config probes introduced by A1/A4 rather than starting a competing harness.

Use isolated temporary fixture trees and the actual root oxlint/dependency-cruiser configuration. Adapt only fixture-root and plugin-resolution paths; do not reproduce production rules in a hand-maintained test config. Resolve pinned tool binaries through declared dependencies. Assert exit codes and expected diagnostics.

The matrix covers allowed and forbidden fixed package edges even after manifest edits; undeclared edges; app and feature boundaries; plural rules in TS and TSX; process-environment access inside and outside declared composition roots; retained title/em-dash gates; and legitimate long comments after F1. Test suppression behavior separately from unsuppressed violations so the baseline cannot hide a broken fixture.

Keep the suite fast and deterministic, with no paid model calls or external services. Give configuration contracts one explicit script and wire that script into the repository lint gate so the ordinary local gate exercises it. Preserve existing unit tests and coverage; coordinate CI invocation with U12 instead of assuming changed-package selection sees root-config changes. Measure the added lint runtime and avoid redundant subprocesses where one fixture invocation can validate multiple independent paths.

Done when deliberately narrowing the plural glob or removing a fixed layer rule makes the corresponding contract test fail, and production lint still passes. The suite must prove behavior through the real configuration, not merely snapshot its text.

### F3. Give glob matching one browser-safe owner

Prerequisites: confirm U24's U17/U20 dependencies and the workspace boundary decision are integrated. Do not import a Node-oriented root barrel into the browser to remove duplication.

- Extract the pure matcher currently duplicated in `packages/brief-core/src/generation/repo-context.ts` and `apps/web/src/features/brief/utils/repoConfig.ts` into a lean owned module, provisionally `packages/brief-core/src/path-matching.ts`, with an explicit `./path-matching` export. No new package or one-file folder.
- Keep server repo-context shaping and browser configuration presentation with their existing owners. The matcher module has no Node globals or runtime dependencies on generators or server code.
- Migrate both consumers. Preserve an existing public export if compatibility requires it; do not leave two implementations behind.
- Reuse existing coverage: the web suite already compares 13 cases with brief-core, and brief-core already has literal expected results and pathological-input tests. Replace the lockstep comparison once it would compare a function with itself. Keep consumer-level behavior checks and one authoritative semantic table.
- Compare old and new behavior on the existing corpus and bounded edge cases before deleting duplication. Preserve separators, wildcard semantics and pathological-input behavior.

Done when owner and consumer suites pass, declared exports resolve, web production build and dependency inspection show a browser-safe import path, and no duplicate matcher remains. If the diff grows too large, put meaningful missing characterization coverage first, then the extraction; keep both PRs consecutive.

### F4. Split SubmitModal by view without moving flow ownership

Prerequisites: U28's U17 and U20 boundary/contract work. Design may be prepared earlier; implementation waits. This is a scoped pilot, not completion of every U28 acceptance item.

The reviewed tip uses a `Record<SubmitView, ReactNode>` that constructs every branch's element tree; only the selected branch mounts. Receipt-text computation is already gated. Preserve this distinction when describing the improvement.

- Keep shared submission state, draft ownership, stale acknowledgement and brief-switch resets in the parent flow.
- Extract cohesive advisory, verdict and receipt views with small explicit props. Select the active view before constructing its branch, using ordinary control flow. Do not introduce lazy loading or a generic view framework without measured need.
- Retain existing i18n and receipt behavior. Reuse domain-specific shaping where genuinely repeated; keep one-off assignments local.
- Reuse SubmitModal, ReceiptAccordion, useReviewSubmit, brief-switch-flow and receipt tests. Add only missing public cases: a draft survives intended transitions, switching briefs clears the right state, repeated submission is prevented, and stale acknowledgement cannot leak between briefs.
- Preserve the existing modal accessibility contract: initial focus, focus containment, Escape behavior, return to the opener, accessible names and status announcements. Verify keyboard interaction on the rendered modal. Avoid asserting private component identities or render-call counts.

Done when the parent communicates the flow clearly, views own their presentation, existing behavioral and accessibility checks pass, and the web build succeeds. Claim a performance improvement only with measurements; otherwise describe the narrower construction behavior. If needed, split view extraction across two consecutive PRs without introducing transitional duplicate state.

### F5. Extract the worker's anchored-generation responsibility

Prerequisites: U23's U1 review-integrity work, U2 carry-race reproduction/design decisions and U5 retry fixes. Confirm the current ticket state before touching phase boundaries. Do not overlap conflicting U25 work. The pilot excludes atomic-counter changes, new retry semantics, concurrency fixes and wholesale review-session redesign.

F5a first checks coverage through `createGenerateTask` and its dependency-injected ports. Existing tests already cover supersession before delta spending, reuse of a persisted brief on retry, persisted hops after model failure, anchoring modes and transient/permanent classification. Add only uncovered ordering, failure or side-effect behavior needed to protect the proposed extraction. Confirm these public seams before writing tests.

F5b groups the anchored planning responsibility behind one cohesive operation. Keep orchestration visible in `apps/worker/src/task/generate.ts`; move supporting decisions and types with their owner. A domain-specific filename is permitted under F1. Do not create a new abstraction for each helper or expose every intermediate value in a giant dependency bag.

Record the operation's inputs, result/refusal shape, side-effect ownership and ordering before moving code. Preserve supersession checks, spend ordering, persisted-state reuse and retry classification. Test through the task boundary and observable ports, using existing fakes. Check the old orchestration can be deleted without recreating the same decision tree in callers.

Done when the task reads as orchestration, callers have fewer internal decisions to understand, behavior and coverage floors hold, and no extra calls, queries or spend paths appear. If the extraction touches a generation surface, prepare the required eval selection and stop for human results. Split additional cohesive phases into later consecutive PRs only when the measured pilot cannot fit the review-size guideline.

## Dependency and remaining-debt map

Do not create duplicate tickets or silently mark existing ones complete. Update tracker scope only in a separately authorized phase. A blocker pauses the dependent PR; implementing that blocker is outside this plan.

| Existing owner | Relationship to this work and closure evidence |
| --- | --- |
| [U12 CI verification](https://app.notion.com/p/3d25e9400eeb814cb851da1071d02284) | Remains the first release-verification priority after U0. Coordinate F2 invocation and root-config change selection. Close on actual required-check execution, not a locally passing command. |
| [U17 boundaries](https://app.notion.com/p/3d25e9400eeb8153bebfd20852c52c8b) | Owns remaining dependency violations; remove entries as edges disappear. Prerequisite for the domain/frontend pilots. |
| [U20 contract ownership](https://app.notion.com/p/3d25e9400eeb81268563fd6ed60797e3) | Reconcile its older API-owner wording with the accepted separate HTTP app/contract decision. Do not implement against a stale proposed owner. |
| [U21 exports](https://app.notion.com/p/3d25e9400eeb8138867cdd818ba993c4), [U22 file migration](https://app.notion.com/p/3d25e9400eeb81adb908ec831dba786c) | Keep dedicated migrations. F1 changes how support placement is reviewed; it does not complete export or casing debt. Avoid overlapping their files with debt-burning work. |
| [U23 worker structure](https://app.notion.com/p/3d25e9400eeb81adaf94d381f9b429fe) | F5 is one pilot. Preserve dependencies on [U1](https://app.notion.com/p/3d25e9400eeb8137a890ef44a4f60a9a), [U2](https://app.notion.com/p/3d25e9400eeb81cfac54fee7676d3337) and [U5](https://app.notion.com/p/3d25e9400eeb814ea934fda8e23c31f4). Measure responsibility and public behavior, not file count alone. |
| [U24 domain/config ownership](https://app.notion.com/p/3d25e9400eeb81f8b0edf9030f728fe9) | F3 removes one duplicate algorithm. Preserve U17/U20 and remaining U15 dependencies; confirm which env work U0 actually completed. |
| [U26 title/comment debt](https://app.notion.com/p/3d25e9400eeb8117b2d1f998787dbda2), [U27 related cleanup](https://app.notion.com/p/3d25e9400eeb8139a3e3c3bd6549be6a) | Count surviving enforced-rule debt separately from retired comment-run entries. Close only against the updated accepted scope. Do not overlap U15 or export/rename migrations in the same member. |
| [U28 frontend structure](https://app.notion.com/p/3d25e9400eeb8117a39ed92786df0361) | F4 is one modal pilot, conditional on U17/U20. Existing numeric component/bundle targets remain ticket acceptance until explicitly revised; this plan does not silently replace them or claim the whole ticket complete. |
| [U33 documentation](https://app.notion.com/p/3d25e9400eeb81069feccbac1db8aa0e) | Keep runtime-map, ADR-status and glossary work with this owner. Avoid duplicating the completed U0 rules consolidation. |

The reviewer-held file and comment decisions do not decide unrelated policy mismatches, such as the current `eqeqeq` null exception. Record such issues with their owners instead of silently widening this implementation.

## Validation and completion

For each implementation PR, record the exact tested head, relevant commands and exit codes, changed public behavior, coverage outcome, baseline changes by rule, and unresolved external evidence. Re-run affected checks after a rebase or material edit; broaden testing only for new risks or failures.

Before tests are written, confirm the proposed seams: actual configuration subprocesses for A1/A4/F2, exported matcher behavior plus consumer behavior for F3, rendered modal interactions for F4, and the task factory's observable ports for F5. Characterization uses existing passing tests where adequate; new behavior follows one failing test then its implementation. Private helper extraction alone does not warrant a new test suite.

Review the pilots by asking whether callers need less internal knowledge, responsibilities change together, and existing failure/ordering behavior remains clear. Report concrete ownership removed, duplicated algorithms deleted and verified interactions. Smaller files and lower suppression counts alone are not proof of better design.

This planning phase is complete when this document contains the agreed policies, workflow, PR sequence, blockers and acceptance evidence. It remains uncommitted. Future implementation completion requires the specified PRs and checks, with human eval results where applicable; merging and branch deletion remain separate owner actions.
