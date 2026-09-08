# U0: Standards and lint baseline

Board ticket: [Bring the codebase to release quality (BRIEF-256)](https://app.notion.com/p/3d25e9400eeb81b1982ed359075ef72e), child page [U0 Standards and lint baseline (do first)](https://app.notion.com/p/3d25e9400eeb819aaac1ff4d9c7939e4).
Decisions: [Wayfinder map: Standards and lint baseline (U0)](https://app.notion.com/p/3d25e9400eeb81b7bd4bf028cc2b458e). Every rule wording, tool choice and fix list below comes from a closed ticket on that map; the map wins where this plan disagrees, and this plan gets fixed.
Evidence: `logs/audit-2026-09-04/` (gitignored). `BACKLOG.md` section 5 holds D1 to D14, `sub-agents-md.md` the AGENTS.md corpus audit, `pr-review-mining.md` section 4 the review asks.

## What ships

Three PRs; the third is a stack of nine.

- **PR 0**: `api`, `worker`, `cli` move from `packages/` to `apps/`. The anchored-generation helpers move from worker into brief-core so `tools/categorizer` stops importing an app. An ADR records what apps, packages and tools are.
- **PR 1**: the rules. Root AGENTS.md absorbs D1, D2, D3, D8 and the audit's unencoded review asks; the AGENTS.md corpus goes from 15 files to 12; every package file loses its restatements; paths are written once as `apps/api`, `apps/worker`, `apps/cli`.
- **PR 2**: the gates. oxlint becomes the only linter with a house plugin for the selector rules; dependency-cruiser holds package and feature boundaries; every deterministic rule ends at `error`. Four rules plus max-depth, the copy lint and the hook rules get no baseline (their violations are fixed inside the stack); the boundary lint and the title/comment rules keep a generated baseline that only shrinks.

Not here: migrating the 14 api default-export files (U21), file renames the shape rule implies (U22), burning the boundary and title/comment baselines (U17, U26), running `api` as its own process and the `contract` package (board ticket [Run the API as its own process](https://app.notion.com/p/3d25e9400eeb812180fee3c7b9d38e73)), CI execution and required checks (U12).

## Git requirements (git-eng, mandatory)

Invoke the `git-eng` skill for every git operation during implementation. Confirmed with Idan on 2026-09-06:

- This plan stays **uncommitted on `main`**; committing it is Idan's call.
- **Branches stack**, each off the previous, never waiting on a merge:
  `refactor/BRIEF-256/apps-move` off `main`, then `docs/BRIEF-256/rules`, then the nine PR 2 branches `chore/BRIEF-256/lint-1-oxlint-only` through `chore/BRIEF-256/lint-9-flip` (names in the PR 2 section).
- **Chunked commits** per branch, logical units. No `Co-Authored-By` trailers, no AI attribution anywhere.
- **Before every commit**, run `security-reviewer` and `performance-reviewer` in parallel on the staged diff. Neither has Bash: write `git diff --cached` to a scratch file and hand each the path. Findings at confidence 80 or above get fixed and re-reviewed before the commit lands. The security pass matters most on PR 2 step 1 (a JS plugin that reads every source file and every comment) and step 7 (env threading).
- **Ready-for-review PRs** via `gh`, base `main` for PR 0, the previous branch for the rest. Titles follow git-eng: `[BRIEF-256] <prefix>: <Title Case>`. Bodies: Overview, Changelog, no Images section unless a screenshot exists; one verification line; `unslop` pass before publishing or editing.
- After the stack is up, the PR-stack lifecycle applies: one review subagent per PR, at most two rounds, medium-and-above findings only, fixes upstream first, retarget children as parents merge, verify with `git merge-base --is-ancestor` before realigning (GitHub rewrites the child on squash-merge here). Merging and branch deletion are Idan's.
- The turn-end Stop hook runs `pnpm lint`; every branch is green by exit code before its turn ends. Lint each branch bottom-up after a rebase.

## Specialist skills (mandatory, confirmed 2026-09-06)

- `typescript-eng`: every code change, the house plugin included.
- `writing-for-agents`: every AGENTS.md edit in PR 1 and the ADR in PR 0. Plain words, no internal metaphors, one line per rule, no rationale essays.
- `tdd`: the house plugin rules (fixture files that must and must not report, before the rule), the brief-core move in PR 0 (worker's anchoring tests move with the code and stay green), the env threading in PR 2 step 7.
- `domain-modeling`: the ADR in PR 0 (workspace member kinds) and a dated update on ADR 0041 in PR 1 (controllers and handlers are named exports).
- Standing from repo rules: `unslop` on every PR body; judge every gate by exit code; never grep with a glob that can match an env file; log lines earn their level.

## Facts the cut rests on

Measured on `main` at `30f5e360f`, 2026-09-06.

- `pnpm lint` exits 0 on main. `pnpm -r typecheck` exits 2 on main with one error, `apps/web/src/features/brief/utils/validation.test.ts:403` (`ParseWarnSink` should be `ParseWarnings`), the U12 item the audit recorded. Every package except apps/web is clean. This work never touches that file, so each PR judges typecheck by "no new errors against main" until Idan says which PR carries the one-line fix (see Open items).
- 275 tracked files under `packages/api`, `packages/worker`, `packages/cli`. Path references outside fixture data: root `package.json` scripts (6 lines), `knip.jsonc` (4), `.oxlintrc.json` overrides (4 globs), `docker-compose.yml:88`, `packages/worker/Dockerfile:31`, `.dockerignore:5` (comment), eight AGENTS.md files, `docs/dev/*.md` and `docs/self-host/generators.md`. `freshness.yml`, `audit.yml`, `ci.yml` already glob `apps/*` and `packages/*`. No tsconfig references any of the three; `apps/web/tsconfig.json` only maps `@web/*`. The eval fixture JSON and `expected.ts` files mention `packages/api` as diff content and are not touched.
- `packages/worker/src/task/anchoring.ts` (731 lines) is pure: it imports only from `brief-core`, `types` and one type, `CompareFiles`, from `github`. brief-core does not depend on `github`, and `github` reaches brief-core through `persistence`, so the shape must move with the functions rather than be imported. `tools/categorizer/eval/pairs.ts` imports `planAnchoredGeneration` and `stitchBrief` from `worker`; `worker/src/task/generate.ts` and `worker/test/anchoring.test.ts` are the other consumers.
- `no-nested-ternary` reports 67 today with oxlint alone (32 apps/web, 17 api, 9 cli, 4 generators, 3 persistence, 1 github, 1 categorizer). The ratchet ticket recorded 129. Re-measure at the start of steps 5 and 6; the cut per tree stands either way.
- `max-depth` at 3 reports 39 in 19 files: `brief-core/src/generation/repo-context.ts` 7, `apps/web/src/features/brief/utils/repoConfig.ts` 7, `worker/src/task/generate.ts` 5 (three at depth 5), `apps/web/.../viewModel.ts` 3, `cli/src/commands/read.ts` 2, `apps/web/.../useReviewSubmit.ts` 2, thirteen files at 1.
- Conditional spreads: 264 (apps/web 129, packages 128, tools 7; 41 in tests). Measured with the probe plugin on the ratchet ticket.
- Copy lint in `all` mode with the chosen excludes: 52 reports in 15 files (46 copy, 6 receipt lines in SubmitModal). Hand-built plural sites: 8.
- Title and comment rules: 748 long titles, 578 parenthetical titles, 368 em-dash titles, 694 comment runs of 5+ content lines, 3,291 em-dash comment lines. Baseline, not fixes.
- Lateral feature imports in apps/web: about 57 import specifiers (196 module edges) behind the `@web/features` alias; three `api` edges (web runtime mount, five cli test files, one i18n test). One package-level cycle: `packages/i18n/test/wire-pin.test.ts` imports `api`.
- 40 `eslint-disable` directives in source and tests; 17 `oxlint-disable`. Nine files carry `eslint-disable-next-line no-restricted-syntax` for a bespoke raw `<button>`.
- Installed: oxlint 1.72.0 (latest 1.81.0), eslint 10.8.0, eslint-plugin-i18next 6.1.5, dependency-cruiser latest 18.2.0. The hidden `--suppress-all` and `--prune-suppressions` flags were verified on 1.72.0.
- The `research/harness-loading` branch is gone with the other deletions. Its one commit is still reachable as dangling commit `1805259ab`; a copy sits at `/tmp/u0plan/harness-context-loading-research.md`. Its bottom line for PR 1: Claude Code is the only harness reading these files, the root file is always loaded and package files load on touch, and the 47-byte `CLAUDE.md` pointer per package must stay. Deleting a package AGENTS.md means deleting its pointer too.

## Decisions the map left to this plan

- **House plugin location and shape.** A workspace tool, `tools/oxlint-plugin-house`, package name `oxlint-plugin-house`: `src/index.mjs` exports the plugin (`meta.name: "house"`), `src/rules/` holds one file per rule (peers, no barrel), `test/` holds one fixture folder per rule plus a vitest that runs the pinned oxlint against the fixtures and asserts the diagnostics by rule id and line. Rules are plain `.mjs` with JSDoc types because oxlint loads plugins through Node with no TypeScript loader; that is a stated deviation from strict TS, confined to this tool, and the fixture tests are the type safety. `.oxlintrc.json` lists it as `"jsPlugins": ["./tools/oxlint-plugin-house/src/index.mjs", "eslint-plugin-i18next"]`.
- **Rule ids and options.** `house/no-enum`, `house/extensionless-import`, `house/no-conditional-spread`, `house/no-raw-button`, `house/no-blank-target`, `house/no-process-env`, `house/no-render-function`, `house/no-hand-built-plural`, `house/test-title` (`{ "maxLength": 70 }`; a parenthesis always fails), `house/comment-run` (`{ "maxContentLines": 4 }`; five fails), `house/no-em-dash` (no options). The process.env allowlist is an `overrides` block in `.oxlintrc.json` that turns `house/no-process-env` off for the root files, matching how the logging boundary is scoped today. The rule reports `process.env` member access and any `import ... from "process"` or `"node:process"`, so the alias cannot dodge it.
- **Composition-root declarations** in the five AGENTS.md files land in PR 1 with every other rule line; PR 2 step 7 makes them true. Between the two, brief-core's declaration is false for the days the stack is open, which is the state today.
- **AGENTS.md corpus fold** belongs to U0 (the map locked it); U33 shrinks to ADR statuses, the runtime map and the glossary.
- **Stack length is nine**, not eight: the copy fixes the i18n ticket assigned to "PR 2's stack" are a PR of their own because Idan reviews copy and catalog keys differently from mechanical rewrites.
- **`import/no-default-export` override** for api controllers and handlers stays until U21 migrates the files; PR 0 only rewrites its globs.
- **eslint-plugin-i18next stays a root devDependency**, loaded by oxlint. knip will report it unused once `eslint.config.js` is gone; step 1 lists it under knip's root `ignoreDependencies` with the one-line reason.

## Pre-flight (before PR 0, no branch)

1. `pnpm lint >/dev/null 2>&1; echo $?` and `pnpm -r typecheck` on `main`. Done 2026-09-06: lint green, typecheck red at the one pre-existing apps/web test line. A red gate on code this work never touches is reported to Idan, not fixed here.
2. Confirm `git worktree list` shows main only and `git status` is clean. Never `git stash` in this repo; ten foreign stashes sit in the list.
3. Read `/tmp/u0plan/harness-context-loading-research.md` (or `git show 1805259ab:docs/dev/harness-context-loading-research.md`) before PR 1.

## PR 0: apps move

Branch `refactor/BRIEF-256/apps-move`, base `main`. About 275 renames (no content diff), plus roughly 120 changed lines of paths and 800 moved lines for the anchoring helpers.

1. `git mv packages/api apps/api`, `git mv packages/worker apps/worker`, `git mv packages/cli apps/cli`. Workspace package names (`api`, `worker`, `mergebrief`) do not change; `pnpm-workspace.yaml` already globs `apps/*`.
2. Rewrite paths: root `package.json` scripts (`app:host`, `dev`, `build`, `typecheck:worker`, `test:worker`, `check:catalog`), `knip.jsonc` (the three workspace blocks and the line 25 comment), `.oxlintrc.json` (the logging-boundary globs and the controller/handler globs), `docker-compose.yml:88`, `apps/worker/Dockerfile:31`, `.dockerignore:5`, `docs/dev/pre-release-testing.md`, `docs/dev/brief-40-testing.md`, `docs/self-host/generators.md`, `docs/repo-config/instructions-template.md`, `docs/oss-roadmap.md`, `apps/cli/README.md`. Grep after: `rg -n 'packages/(api|worker|cli)\b' --glob '!tools/categorizer/eval/**' --glob '!docs/mvp/**' --glob '!docs/adr/**' --glob '!logs/**'` returns only AGENTS.md lines (PR 1 owns those) and historical merge guides.
3. Move `apps/worker/src/task/anchoring.ts` to `packages/brief-core/src/anchoring/index.ts` with `types.ts` beside it (`AnchorPlan`, `AnchorPlanArgs`, `FrozenCarry`, `ReLookEntry`, `StitchArgs`, `StitchError`, `StitchResult`, and `CompareFiles`, which brief-core now owns; `github` and `worker`'s `github-port.ts` import it from brief-core). Export from brief-core's `src/index.ts`. `apps/worker/src/index.ts` drops the anchoring block; `generate.ts` and `tools/categorizer/eval/pairs.ts` import from `brief-core`; `tools/categorizer/package.json` drops `worker`. `worker/test/anchoring.test.ts` moves to `packages/brief-core/test/anchoring.test.ts`. Coverage floors: brief-core gains tested lines, worker loses them; check both vitest thresholds still pass by exit code.
4. ADR `docs/adr/0042-workspace-member-kinds.md` (domain-modeling): the test (own process or binary, now or by design; code apps share; repo-local scripts), the sort, "nothing imports an app, tests included", the three api edges that stay baselined until the split-out ticket, and the future `packages/contract`. Add the glossary terms App, Package, Tool to `CONTEXT.md` only if they are absent; the apps ticket said CONTEXT.md gets nothing else.
5. No process entry, no Dockerfile, no start script for `api`. No AGENTS.md edits beyond none: PR 1 writes every path once.

Done when `pnpm lint`, `pnpm -r typecheck`, `pnpm -r test` and `docker compose build worker` pass by exit code, and `pnpm -C tools/categorizer test` passes without a `worker` dependency.

Model: Fable 5.1, medium effort, main thread. Mechanical, but every missed path is a broken compose or CI run.

## PR 1: the rules

Branch `docs/BRIEF-256/rules`, base `refactor/BRIEF-256/apps-move`. About 600 lines touched across 15 files, net around minus 90. One PR: Idan reads the rules diff whole, and splitting prose by package would hide the contradictions the diff is meant to remove.

Register for every line: plain words, one short line per rule, no "Bold claim, elaboration" with an em-dash, no shouting, no ticket or PR ids (this file is exempt; AGENTS.md is not). The `writing-for-agents` skill governs.

### Root AGENTS.md

New or replaced lines, in the order the file reads today:

- Named exports: drop the "default exports where a framework requires them" clause into a path list (vite, tsup, drizzle configs, the TanStack server entry). Controllers and handlers are named exports; the api carve-out is gone.
- Absence (D1): `undefined` means absent; `null` only where a wire or DB shape carries it, converted at the boundary; `Result` for parse failure or refusal; a function never returns both. Loose `== null` is banned; `eqeqeq` holds it.
- Return types (D2): an exported function annotates a named type declared separately; internals infer.
- `prop?: T | undefined` (D3): rewrite the existing line. Plain `?:` by default; `| undefined` only where a caller forwards a maybe-value; the flag is `exactOptionalPropertyTypes` and the line says so.
- Result versus throw: extend with the sanctioned edge contracts (api's `ApiError` classes, the generator and worker throws their AGENTS.md name).
- Ticket-id rule: scope becomes "any tracked file except `docs/adr/**`"; the four named doc files go.
- Workspace kinds, verbatim from the apps ticket: "`apps/` holds members that run as their own process or ship as their own binary (`web`, `api`, `worker`, `cli`). `packages/` holds code apps share. `tools/` holds repo-local scripts run by hand, never deployed, never imported. Nothing imports an app, tests included: apps talk over HTTP or the Postgres job queue. The HTTP contract between apps is a package both sides import."
- Package edges, in prose on the package-entry line: `types` imports no workspace package; `logging`, `i18n`, `generators` import only `types`; `api` never imports `cli`, `worker` or `web`; in apps/web only `src/server/**` and tests import `api`.
- Imports, verbatim from the boundary ticket: "Package imports use the package root or a subpath its `exports` declares. Feature imports in apps/web use the feature index or one segment below it. dependency-cruiser holds the existing violations in the root known-violations file; a PR that removes one regenerates the file, and the file only loses entries." Plus: no aliasing an enum-like map on import, no star imports, one import per package, no deep import into another package's internals.
- Shared values, verbatim: "A value two packages both need moves to the nearest package both already depend on, under a domain subfolder. Shapes and type helpers (`ValueOf`) go to `packages/types`. A new package is the exception, not the default, and names its reason."
- File shape, replacing the "Package entry" bullet, drafted from the eleven numbered decisions on the file-shape ticket (no prose exists yet; this is the one block Idan reads hardest): a lean domain file stays a file; one that grows types, consts or utils becomes a folder with `index.ts` as the main and `types.ts`, `consts.ts`, `utils.ts`, `schemas.ts` beside it; a grouping folder holds peers, has no `index.ts`, callers import the member, shared support sits at folder level; the name list is closed (`index`, `types`, `consts`, `utils`, `schemas`, `logic/`); `helpers.ts` is `utils.ts` and `constants.ts` is `consts.ts` in source, `helpers.ts` stays legal under `test/`; `types.ts` appears at the first outside import or three types, same numbers for consts and utils; `logic/` opens at the second function where the main orchestrates, React trees use a facade hook or `utils.ts` instead; never a one-file folder; shared by two members hoists to the nearest common owner; plural folder names for peers, singular for one thing split into parts; api, worker and cli follow it, the axis is React versus not; tests stay per-package. Include one before/after tree of a real folder (the file-shape grill landed on `worker/src/task`).
- Casing: kebab-case for every file and folder; PascalCase component files and folders and camelCase `use*` hooks are the only exceptions. Renames ride U22.
- Function declarations over arrow consts at top level; verb-first covers arrow consts and test helpers (`stub*`, `make*`).
- Nesting and length, verbatim from the caps ticket: "Blocks nest at most three deep inside a function; extract a function or return early past that. `max-depth` holds this at error." and "A function reads in one screen; about 60 lines is the signal to split, not a cap. A component whose logic sits above a wall of JSX splits into sub-components; a hook longer than one screen splits into sub-hooks or pure functions."
- Magic numbers become a named const or token; no one-letter locals.
- Enum-like maps: the map and its `ValueOf` type live in `types.ts`; `z.enum` reads the map, never a literal union.
- Interfaces for object shapes (promoted from repo-config and persistence).
- `zod` is imported as `zod/v4` (promoted from three files). The zod 4 bump is U30's.
- One finding means a sweep: before replying to a review comment, fix every occurrence in the stack.
- Test titles and comments, from the gate ticket: a test title names the behaviour in at most 70 characters, no em-dash, no parenthetical, `describe` included; a comment run of five or more lines is a defect and comments carry no em-dash; both lint at error against `oxlint-suppressions.json`; a PR that edits a listed file clears that file's entries for the rules it trips and prunes the count.
- Linter charter, verbatim from the ratchet ticket: "oxlint is the only linter. A convention oxlint has no native rule for lives in the house JS plugin as a selector rule; user-facing copy is gated by eslint-plugin-i18next loaded through oxlint. Every deterministic rule runs at error."
- Eval bullet: add "agents never invoke the harness; a human runs and spends" (folded from categorizer) and the `--case` single-id and `--rebaseline` lines.
- `packages/types` fold: zero dependencies; the two deliberate cross-package shapes (`GenerateJobPayload`, `DraftPolicy`) and why they sit there.
- Nested ternary line: drop the "67 pre-existing violations, warn until the ratchet" clause; the rule is at error after PR 2, and until then the line says the stack is landing.
- CI-hole bullet stays until U20; reword the first hole to the true one (an api-only change does not select `packages/i18n` if the filter skips devDependency consumers; PR 1 verifies this with `pnpm -r --filter "...[<sha>]" ls --depth -1` against a commit touching only `apps/api`; if `i18n` is selected, the hole and api's line 27 sentence both go).
- Paths: every `packages/api` becomes `apps/api` (the Zod wire-bounds line, the error-code recipe line, the logging boundary line).

### Package files

- **Delete** `packages/types/AGENTS.md` and `tools/categorizer/AGENTS.md` with their `CLAUDE.md` pointers; their surviving lines are in root above. The categorizer's `eval/README.md` keeps the mechanics.
- **`apps/api/AGENTS.md`**: lines 38 and 39 become named exports (`createXxxHandlers`, `xxxController`); line 43 keeps the ~40-line orchestration cap; line 35 stops saying "no exceptions" (U21 reconciles the layout, the line describes the target); line 27's CI sentence per the verification above; line 87 drops "built inline, not imported" (shared fixtures live in test utils per root; U18 moves them); add the controller-call line: a handler never calls the controller inside the response expression, the result lands in a named const first; the Verification section keeps only `manifest:check`.
- **`apps/web/AGENTS.md`**: replace the i18n paragraph (lines 12 to 15) with the three copy-lint lines from the i18n ticket (catalog for every `.ts` and `.tsx` literal that is sentence-shaped or Capitalised; plurals through `_one`/`_other` with `count`; the two file-shaped exemptions, receipt and head meta); add the "Hooks and JSX" block, five bullets verbatim from the hook ticket (memoize for a measured cost or a contract-visible need; no spread inside JSX except a primitive forwarding rest to its DOM element; nothing computed inside JSX; no `render`-prefixed function outside tests; an effect syncs React with something outside it, idempotent, real deps); rewrite lines 31 and 32 (feature index or one segment below, global `src/` folders never import features, wanting deeper is the promotion signal, cross-feature fixtures live in `src/test`); `packages/api` becomes `apps/api`; name `src/server/webhookApp.ts` as the composition root and `server/logger.ts` as the sanctioned singleton.
- **`packages/brief-core/AGENTS.md`**: line 13 names the two CLIs, not `cli/context-providers.ts`, as the composition root; line 16 shrinks to the four-entry tracker shape in three lines; line 17 stops claiming "nothing else reads `process.env`" until step 7 lands, then says it; delete line 19 (consumers) and line 30 (zod, promoted); Verification section goes.
- **`packages/repo-config/AGENTS.md`**: delete lines 28 to 30 and 32 to 34 (Result restatement, zod, interfaces, bare triplet). Target 22 lines.
- **`packages/generators/AGENTS.md`**: declare the root (`harness/run.ts` will require `env` after step 7); drop the zod line; Verification keeps only the manual smoke line.
- **`packages/persistence/AGENTS.md`**: `createEnvKeyProvider` takes `env` explicitly (true after step 7); line 43's verb-first restatement shrinks to the `tenantColumns()` exception; Verification keeps the PGlite and real-Postgres notes.
- **`apps/worker/AGENTS.md`**: line 25 says `main.ts` is the only reader and brief-core's helpers take their values as parameters; lines 33 and 34 keep the `evt` sub-bullets, lose the heading restatement; Verification keeps `start` and its env needs.
- **`packages/github/AGENTS.md`** lines 16 and 19, **`packages/logging/AGENTS.md`** lines 14 and 15: delete (layout restatements). Bare Verification triplets go in i18n, logging, github.
- **`apps/cli/AGENTS.md`**, **`tools/ingest-briefs/AGENTS.md`**: path rewrite only; their Verification sections carry real facts and stay.
- Every file: "Repo-wide conventions apply" sits at line 5 or 7, never buried; drop restated "Package entry" lines except cli (`bin.ts`) and worker (two entries).
- ADR 0041 gets a dated update block: controllers and handlers are named exports.

Done when the corpus is 12 files, `pnpm lint` passes (prettier ignores markdown, so this is the link and format check only), and a grep for `packages/api|packages/worker|packages/cli` across AGENTS.md returns nothing.

Model: Fable 5.1, high effort, main thread. The rules are Idan's voice and the file-shape block has no drafted wording; this is the one part of U0 that is writing, not mechanics.

## PR 2: the gates

Nine stacked branches off `docs/BRIEF-256/rules`. Until step 9 merges, a new violation of a no-baseline rule can still enter `main`, so the stack lands quickly. Each fix step proves itself with the rule forced on from the command line (`pnpm exec oxlint -D <rule> apps packages tools`, or the step's own scoped config under `/tmp`), zero hits, while `.oxlintrc.json` keeps the rule off until step 9.

### Step 1: oxlint only

Branch `chore/BRIEF-256/lint-1-oxlint-only`. About +450/−280: the plugin and its fixtures, minus `eslint.config.js`.

1. Create `tools/oxlint-plugin-house` (package.json with `test` and a `typecheck` that runs `tsc --checkJs` over `src/`; devDependency on the pinned oxlint). Rules ported from `eslint.config.js` exactly: `no-enum` (`TSEnumDeclaration`), `extensionless-import` (the six selectors with the anchored regex), `no-raw-button`, `no-blank-target`. Their fixture tests come first (tdd): one `bad.ts`/`good.ts` pair per rule, the vitest spawns oxlint with `--format json` and a fixture config, asserts rule id and line.
2. `.oxlintrc.json`: `jsPlugins` with the house plugin and `eslint-plugin-i18next`; `i18next/no-literal-string` at error over `apps/web/src/**/*.tsx` with exactly today's `jsx-only` options (attribute excludes, the three word patterns; leave `callees` untouched so the defaults stay); the four house rules at error repo-wide, the button and anchor rules scoped by an override to `apps/web/src/**/*.tsx` minus the nine shared component folders; `--report-unused-disable-directives` on; the `eslint.config.js` entry leaves the default-export override.
3. Replace the 40 `eslint-disable` directives with `oxlint-disable` naming the oxlint or house rule (`no-restricted-syntax` sites become `house/no-raw-button`). Regenerate `routeTree.gen.ts` if its directive is generated; otherwise it stays ignored.
4. Remove `eslint`, `@typescript-eslint/parser` from root devDependencies; pin `oxlint` and `oxlint-tsgolint` exact (they are already); knip `ignoreDependencies` for `eslint-plugin-i18next` with the reason. `lint` script becomes `oxlint --type-aware && knip --no-config-hints && pnpm format:check && pnpm -C apps/web lint && pnpm check:catalog`. Update the `ci.yml` comment at lines 50 to 56.
5. Behaviour-neutral proof in the PR body: the same zero hits before and after on every ported rule, and the whole-repo run time.

Model: Fable 5.1, high effort, main thread. The plugin API is alpha and the comment reader (step 2's rules share the harness) is where a subtle bug hides.

### Step 2: gates with baselines

Branch `chore/BRIEF-256/lint-2-baselines`. About +200 hand-written lines plus two generated files (the suppressions file, roughly 600 lines; the known-violations file, roughly 300).

1. House rules `test-title`, `comment-run`, `no-em-dash` with fixtures first: title over 70, title with `(`, `.each`/`.skip`/`.only`/`.todo` forms, template literal without expressions, a `//` run and a JSDoc run of exactly five content lines, a trailing comment after code (not a run), an em-dash in a comment and in a title. All three at error in `.oxlintrc.json`.
2. `pnpm exec oxlint --suppress-all` writes `oxlint-suppressions.json` at the root; commit it. Verify on the pinned version whether the file is read without a flag; if a flag is required, add it to the `lint` script. Verify that a stale count exits 1 and that `--prune-suppressions` shrinks it; record both commands in the PR body.
3. dependency-cruiser pinned exact (18.2.0 today). Root `.dependency-cruiser.cjs`: package edges generated from each `package.json` at config load plus the four hand rules; "no member imports `apps/*`" at error; feature imports in apps/web through the index or one segment below (`import type` included, tests included); global `src/components|hooks|utils|data|test` never import `src/features` at error with no baseline; `src/routes` may import feature indexes. Resolve the `@web/*` alias from `apps/web/tsconfig.json`; if it only resolves with cwd `apps/web`, the lint script runs it twice and the PR body says so. No folder-cycle rule (U17).
4. `depcruise-baseline` writes the root known-violations file: the ~57 lateral specifiers and the three `api` edges. Remove `packages/i18n/test/wire-pin.test.ts`'s `api` import and the `api` devDependency from i18n (the one package-level cycle); the file then pins wording through the catalog alone, or moves to `apps/api/test` if it cannot. Add the dependency-cruiser step to `lint` with `--ignore-known`.

Model: Fable 5.1, medium effort, main thread. The alias resolution and the baseline shape are the only judgment calls.

### Steps 3 and 4: conditional spreads

Branches `chore/BRIEF-256/lint-3-spreads-web` (129 sites, about +380/−250) and `chore/BRIEF-256/lint-4-spreads-packages` (135 sites across generators 25, github 23, worker 23, api 20, brief-core 17, cli 8, persistence 7, repo-config 3, logging 2, tools 7; about +400/−260). The house rule `no-conditional-spread` (two selectors: `ObjectExpression > SpreadElement > ConditionalExpression` and `> LogicalExpression`) lands in step 3 with fixtures, configured off until step 9. Each site becomes: declare the object with its unconditional fields, assign the optional field under an `if`. Tests are not exempt. Prove with `-D house/no-conditional-spread` on the tree: zero.

Model: Fable 5.1, medium effort, one subagent per step, sequential (step 4 branches off step 3). The main session reviews each diff for a spread that changed semantics (`...(a && b)` where `b` could be falsy).

### Steps 5 and 6: nested ternaries

Branches `chore/BRIEF-256/lint-5-ternaries-web` (32 today, about +120/−60) and `chore/BRIEF-256/lint-6-ternaries-packages` (35 today; about the same). Re-measure at the start with `pnpm exec oxlint -c /tmp/u0plan/ternary.json --disable-oxc-plugin --format json`. Replacements in order: a `Record<State, Value>` lookup, if/else, an early return. Prove with `-D no-nested-ternary`: zero.

Model: Fable 5.1, medium effort, one subagent per step, sequential.

### Step 7: depth, hooks, env

Branch `chore/BRIEF-256/lint-7-depth-hooks-env`. About +520/−300 across 30 files.

1. The 39 `max-depth` sites in 19 files (list under Facts). Extract a named function or return early; the three depth-5 blocks in `apps/worker/src/task/generate.ts` (lines 939, 968, 977 on main) go first. No disable unless a block truly cannot flatten; a disable carries its reason.
2. Hook rules: `react/jsx-no-constructed-context-values`, `react/no-unstable-nested-components` at error (zero hits), `react/no-object-type-as-default-prop` warn to error (`BriefView.tsx:127`, `IntentBar.tsx:211`), house `no-render-function` (a `render[A-Z]` function or variable outside test files; one fix, `MarkdownTextarea`'s `renderPreviewPanel` becomes a sub-component). Fixtures first for the house rule. `react-perf` stays off.
3. process.env, seven files, per the roots ticket: `brief-core/src/generation/config.ts` takes the revision-narrative flag through `GenerateTaskDeps` and the CLI entry; `huge-span.ts` gets a `ratio` parameter (default 0.65); `persistence/src/auth/crypto.ts` drops the `env = process.env` default; `generators/src/harness/run.ts` makes `env` required on `HarnessRunArgs` and the adapter option types; `tools/ingest-briefs/src/args.ts` receives `INIT_CWD ?? cwd` from `main.ts`; `apps/web/src/features/brief/server/outDir.server.ts` receives the dir from `webhookApp.ts` or the surface's reader takes it as an argument; `packages/persistence/toDelete-migrate-carrier-to-core.ts` is deleted (and its knip entry). The two brief-core tests that mutate env (`test/generation/huge-span.test.ts`, `revision-narrative.test.ts`) become parameter tests, written before the change. House rule `no-process-env` with fixtures (member access and the `node:process` import), the allowlist override listing the seven roots, `**/*.config.{ts,js,mjs}`, `apps/web/e2e/**`, `**/test/**`, `**/*.test.{ts,tsx}`, `packages/generators/smoke/**`, `tools/categorizer/eval/cli.ts`, `tools/categorizer/scripts/**`. Rule off until step 9; prove with `-D house/no-process-env`: zero.

Model: Fable 5.1, high effort, main thread. Depth extractions in `generate.ts` and the env threading are refactors with behaviour to preserve; the tdd skill applies.

### Step 8: copy and plurals

Branch `chore/BRIEF-256/lint-8-copy`. About +360/−210: 46 literals into the catalog, 6 receipt lines moved, 7 plural sites, catalog keys in `packages/i18n/locales/en.json` and the pseudo locale.

1. `i18next/no-literal-string` reconfigured per the i18n ticket: `mode: "all"`, `"should-validate-template": true`, files `apps/web/src/**/*.{ts,tsx}`, ignores tests, stories, `test/**`, `characterization/**`, `e2e/**` and the four carve-outs (`routes/__root.tsx`, `features/brief/utils/fixtures.ts`, `features/review/utils/receipt.ts`, `features/review/utils/submit.ts`, each with a one-line reason in the config); `words.exclude` adds `^(?![A-Z][a-z])(?![\s\S]*[A-Za-z] [A-Za-z(])[\s\S]*$` to today's three patterns; `callees.exclude` is the plugin's default list (`i18n(ext)?`, `t`, `require`, `addEventListener`, `removeEventListener`, `postMessage`, `getElementById`, `dispatch`, `commit`, `includes`, `indexOf`, `endsWith`, `startsWith`) plus `Error`, `super`, `logger\..*`, `console\..*`, `warn`, `failRead`; `object-properties.exclude` is the default `[A-Z_-]+` plus `error`, `name`, `nativeName`; `jsx-attributes.exclude` unchanged. Expect 52 reports in 15 files before the fixes.
2. Fixes by file: `MarkdownTextarea/useMarkdownTextareaFacade.ts` 18, `MarkdownTextarea/utils.ts` 1, `RiskFlagModals/useRiskFlagModalsFacade.ts` 5, `ComparisonCallout.tsx` 4, `RevisionGutterCell.tsx` 3, `ThreadResolveAction.tsx` 4, `Header.tsx` 2, `TimelineNavigator.tsx` 2, `conversation/utils/digest.ts` 2, `FilterDisclosure.tsx` 1, `RiskAttrsDisclosure.tsx` 1, `ConversationFilterPanel.tsx` 1, `brief/utils/rawSpanDiff.ts` 1, `brief/utils/briefErrors.ts` 1. `SubmitModal.tsx` lines 359 to 382 move to `receipt.ts`.
3. House rule `no-hand-built-plural` (a conditional whose two branches are the literals `""` and `"s"`) with fixtures, at error: `RevisionGutterCell.tsx:52`, `FilterDisclosure.tsx:157`, `FilterDisclosure/utils.ts:18,24`, `ConversationSection/utils.ts:14,17,23` get `_one`/`_other` keys with `count`; `receipt.ts:300` gets a line disable with its reason.
4. Copy the i18n rule keeps at error from step 1; the mode change and the fixes land together in this PR (the ticket's "ships with the fixes it needs"), so this step is green on its own.

Model: Fable 5.1, medium effort, main thread. Idan reviews the English; the agent proposes keys in the catalog's existing naming.

### Step 9: flip

Branch `chore/BRIEF-256/lint-9-flip`. About 30 lines of config.

`no-nested-ternary` to error and its comment rewritten; `house/no-conditional-spread`, `house/no-process-env` to error; `eqeqeq: ["error", "always", { "null": "ignore" }]`; `max-depth: ["error", { "max": 3 }]` with no test override. Merges last and must be green with nothing to suppress. PR body carries the final counts table (every no-baseline rule at zero, the two baseline files' sizes).

Model: Fable 5.1, low effort, main thread.

## Order of work and who runs it

| Part | Model, effort | Invocation | Size |
|---|---|---|---|
| PR 0 apps move | Fable 5.1, medium | main thread | 275 renames, ~120 path lines, ~800 moved |
| PR 1 rules | Fable 5.1, high | main thread | ~600 lines prose |
| Step 1 oxlint only | Fable 5.1, high | main thread | +450/−280 |
| Step 2 baselines | Fable 5.1, medium | main thread | +200 plus generated |
| Steps 3, 4 spreads | Fable 5.1, medium | subagent each, sequential | ~+380/−250 each |
| Steps 5, 6 ternaries | Fable 5.1, medium | subagent each, sequential | ~+120/−60 each |
| Step 7 depth, hooks, env | Fable 5.1, high | main thread | +520/−300 |
| Step 8 copy | Fable 5.1, medium | main thread | +360/−210 |
| Step 9 flip | Fable 5.1, low | main thread | ~30 |

Every PR sits under the 1,000-line ceiling; steps 3, 4 and 7 are the largest and are cut by tree so a reviewer reads one package family at a time.

Every part runs on Fable 5.1 (Idan, 2026-09-06); the effort column is the only thing that varies. If the Fable quota is exhausted mid-part, the standing fallback applies: Opus 5 at high effort finishes that part and its PR body says so.

## Session mechanics (Idan, 2026-09-06)

- One run, PR 0 through step 9, no stop at a PR seam. A stop is only for a decision the plan leaves to Idan, a quota wall, or a broken base.
- Context budget: at about 65% of the window the session compacts and continues; if compaction is not available, the remaining parts are handed to Fable 5.1 subagents spawned from the same main session, one part each, sequential, with the plan path and the branch to base on in the prompt. The main session keeps the stack bookkeeping (branch order, PR numbers, review state).
- When the last PR is open: one Fable review subagent per PR (inline comments via `gh api`, at most two rounds, medium and above), fixes upstream first, then invoke `watch-pr-stack` and leave it armed until every PR merges.

## Evals

No generation-surface file changes: `prompt.ts`, the output schema, validators and salvage, repo-config injection and adapter defaults are untouched. PR 0 moves `anchoring.ts`, which is partition and stitch logic outside the surface. No eval run.

## Open items surfaced while planning

- **Nested ternary count**: 67 by oxlint today against 129 on the ratchet ticket. Either the ticket counted both halves of each nest or the tool changed; steps 5 and 6 re-measure and the PR bodies carry the number.
- **`api` line 27** ("CI's path filter will NOT run that suite") is called stale by the backlog and true by the tooling audit. PR 1 runs the filter and keeps whichever is true.
- **House plugin in JavaScript** is a deviation from strict TS, confined to `tools/oxlint-plugin-house`, with `tsc --checkJs` and fixture tests as the safety. If Idan prefers a TS source with a build step, step 1 adds `tsup` to the tool and the plugin path in `.oxlintrc.json` points at `dist/`.
- **The `research/harness-loading` doc** is only reachable as a dangling commit until a `git gc`. Nothing in U0 commits it; PR 1 reads the `/tmp` copy.
- **Main's typecheck is red** at one apps/web test line owned by U12. The fix is a one-word rename. Idan decides whether it rides as PR 0's first commit (then every PR's `pnpm -r typecheck` is a clean exit code) or waits for U12 (then every PR compares against main). Default if unanswered: wait for U12, compare against main.
- **Idan-side**: the six local branch deletions are done; nothing else waits on him before PR 0.
