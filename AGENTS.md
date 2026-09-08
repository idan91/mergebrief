# Repo-wide agent rules

This file is the canonical repo-standards file; the root `CLAUDE.md` is a symlink to it. Rules here apply to the whole workspace. A rule lives at the level that owns it: member files refine, never restate. A member carries an `AGENTS.md` when it has conventions the root does not state, plus a pointer `CLAUDE.md` that loads it; a new file adds both, a deleted file removes both.

Every rule here binds as written, casing, schema placement, package edges and export shape included. Where a rule names a gate, that gate enforces it, and a red gate blocks the PR.

Three of them are judgment calls instead of fixed answers: when to split support out of a file, which support filename to use or whether to colocate instead, and which verb a function name starts with. Make the call, say why in the PR description, and expect a reviewer who disagrees to argue it there.

`## Debt register` lists the migrations still in flight. A file listed there is not a reason to widen the diff you are already writing: that debt is fixed on its own ticket.

## Workspace

- `apps/` holds members that run as their own process or ship as their own binary (`web`, `api`, `worker`, `cli`). `packages/` holds code apps share. `tools/` holds repo-local scripts run by hand, never deployed, never imported. Nothing imports an app, tests included: apps talk over HTTP or the Postgres job queue. The HTTP contract between apps is a package both sides import. `no-app-imports-another-app` holds this at error, and the edges that predate the rule are listed in the known-violations file, which only ever loses entries.
- Package edges: `types` imports no workspace package; `logging`, `i18n` and `generators` import only `types`; `api` never imports `cli`, `worker` or `web`. The apps/web-to-api imports in `src/server/**` and in tests are grandfathered debt, not a permitted shape: they are in the known-violations file and no new one may be added.
- `packages/types` is types only with zero dependencies: `ValueOf`, `Result`, `Brand` and kin, plus two cross-package shapes no single domain owns. `GenerateJobPayload` is the enqueue-to-drain handshake between `persistence` and `worker`; `DraftPolicy` is parsed in `generators`, enforced in `api` and mirrored in apps/web. Domain types stay with their domain.
- A value two packages both need moves to the nearest package both already depend on, under a domain subfolder. Shapes and type helpers (`ValueOf`) go to `packages/types`. A new package is the exception, not the default, and names its reason.
- Config enters via injection at the composition root; nothing else reads `process.env`. A member that consumes config names its composition root in its own `AGENTS.md`.
- CI selects changed packages plus their dependents (`--filter "...[<base>]"` off the real workspace graph). One hole needs a local run before pushing: an agreement that is not a package edge, such as a wire shape a separate service parses.

## Imports and exports

- Package imports use the package root or a subpath its `exports` declares. Feature imports in apps/web use the feature index or one segment below it. dependency-cruiser holds the existing violations in the root known-violations file; a PR that removes one regenerates the file, and the file only loses entries.
- Extensionless relative imports everywhere (`from "./tenant"`, never `from "./tenant.js"`); every package is bundler-resolved end to end. Extensions only for non-TS assets.
- One import statement per package; no star imports; no aliasing an enum-like map on import; no deep import into another package's internals.
- Import the owner: never re-declare an existing exported type, schema, regex or fixture inline. Shared test fixtures live in test utils.
- Named exports only. Default exports exist only where a framework reads one: vite, tsup and drizzle configs, and the TanStack server entry `apps/web/src/server.ts`. Controllers and handlers are named exports.
- `zod` is imported as `zod/v4`.

## File shape

- Two rules in this section are judgment calls, the split signals and the support-name list: review asks what changes together and what a caller must understand, and the shapes below are the defaults that answer that most often. Everything else here binds as written, casing and Zod placement included, and the package-entry rule is gated by knip and by dependency-cruiser.
- A lean domain file stays a file. One that grows types, consts or utils becomes a folder with `index.ts` as the main file and `types.ts`, `consts.ts`, `utils.ts`, `schemas.ts` beside it.
- A grouping folder holds peers and has no `index.ts`; callers import the member. Support two peers share sits at folder level.
- Default support names: `index`, `types`, `consts`, `utils`, `schemas`, `logic/`. A domain-specific filename is better where it names the thing the file owns, and colocation is better where splitting would scatter one decision; either choice is argued in the PR, not in a comment. In source `helpers.ts` is `utils.ts` and `constants.ts` is `consts.ts`; `helpers.ts` stays legal under `test/`.
- The first outside import or the third type is the signal to open `types.ts`; the same signal opens `consts.ts` and `utils.ts`. These are the point to ask the question, not a threshold that decides it.
- `logic/` opens where the main file only orchestrates and the steps are worth naming. React trees use a facade hook or `utils.ts` instead.
- Never a one-file folder. Support two members share hoists to the nearest common owner.
- Folder names are plural for peers, singular for one thing split into parts.
- api, worker and cli follow this shape; the axis is React versus not, never app versus package. Tests stay per member.
- Casing: kebab-case for every file and folder. The only exceptions are PascalCase component files and folders and camelCase `use*` hooks. Existing names are renamed on their own ticket.
- Zod schemas live beside their owner, the route, operation, store or script that parses with them. A `schemas.ts` serves one owner; duplicated wire bounds share one module at the closest common owner (`apps/api`'s `routes/repos/pr/wire-bounds.ts`). `packages/brief-core/src/types.ts` is the domain contract and keeps its schemas.
- A package entry is `src/index.ts`, a curated barrel and the `exports["."]` target. `index.tsx` feature barrels are an apps/web convention.
- Target shape of `apps/worker/src/task`, a grouping folder whose one grown member becomes a folder:

  ```
  today                          target
  task/                          task/
    entry-comment.ts               entry-comment.ts
    failure.ts                     failure.ts
    generate.ts   (1,700 lines)    generate/
    github-port.ts                   index.ts    createGenerateTask; orchestrates
    issue-api.ts                     types.ts    GenerateTaskDeps, GenerateTaskHelpers
    owner-follow-up.ts               consts.ts   the poll interval, the audit operation
    payload.ts                       logic/      the pure steps: supersession watch,
    repo-config.ts                               revision artifacts, delta warm
    spend.ts                       github-port.ts
    sweep-audit.ts                 ...
  ```

## Types and values

- Strict TS: no `any`, no bare `as`. Zod or type guards at boundaries; tests are exempt from the bare-`as` ban.
- No `enum`: `as const` maps plus `ValueOf<T>`. Keys SHOUT_CASE, string values kebab-case. Map names are PascalCase and plural, the `ValueOf` type singular: `const PullRequestSources = {...} as const; type PullRequestSource = ValueOf<typeof PullRequestSources>`.
- An enum-like map and its `ValueOf` type live in `types.ts`. `z.enum` reads the map, never a literal union.
- Interfaces for object shapes; `type` for unions, intersections and mapped types.
- Absence: `undefined` means absent. `null` appears only where a wire or DB shape carries it, converted at the boundary. Parse failure and refusal return `Result`. A function never returns both `null` and `undefined`. Loose `== null` is banned; `eqeqeq` holds it.
- An exported function annotates its return with a named type declared separately; internals infer.
- `prop?: T | undefined` is deliberate under `exactOptionalPropertyTypes`. Plain `?:` by default; add `| undefined` only where a caller forwards a maybe-value.
- Expected failures return `Result`; `throw` is for programmer and infra errors. Three edge contracts throw on purpose and each is named in its member's `AGENTS.md`: api's `ApiError` classes at the HTTP layer, the generator's `generate()` after construction returned `Result`, and the worker's transient job failures so graphile retries. Error messages never carry secrets, tokens or connection strings.
- Magic numbers become a named const or token. No one-letter locals.

## Functions and naming

- Function names start with a verb and name what comes back: `getSocketAddress`, `deriveAttentionItems`, `shapeSubmitComment`, `resolveBriefSearch`, `parseGeneratePayload`. Not `socketAddress`, not `commentOf`, not `withoutDiffRows`. Which verb is the author's call: pick the one that tells the caller what the function does, and expect review to argue about it rather than a rule to decide it. Route factories keep `xxxRoute` / `xxxRoutes`. The rule covers arrow consts and test helpers (`stub*`, `make*`).
- Function declarations over arrow consts at top level.
- Names use the domain's own nouns; no invented shorthand. Generic type parameters get descriptive names, not bare `T`, when more than one is in play.
- Blocks nest at most three deep inside a function; extract a function or return early past that. `max-depth` holds this at error.
- A function reads in one screen; about 60 lines is the signal to split, not a cap. A component whose logic sits above a wall of JSX splits into sub-components; a hook longer than one screen splits into sub-hooks or pure functions.
- Blank lines separate a function's logical steps (parse, guard, act, respond). A function with none is a wall; one with a blank line between every statement is noise. Group by step, not by line.
- No expression nests more than two calls; a compound boolean or computed return value gets a named const first.
- No nested ternaries: one condition per ternary. Replacements in order: a `Record<State, Value>` lookup, if/else, an early return. `no-nested-ternary` holds it at error.
- Conditional fields are assigned, not spread. Declare the object with its unconditional fields, then assign the optional ones under an `if`; never `...(cond ? { x } : {})`. `house/no-conditional-spread` holds it at error.

## Copy, logging and comments

- User-facing copy lives in the `packages/i18n` catalog, never hard-coded in components or route handlers. A new wire error code follows the recipe in `apps/api/AGENTS.md`; its `errors.<code>` template rides the same change. The artifact noun is lowercase "brief" mid-sentence in user-facing copy; the product is "MergeBrief".
- Logging goes through the `packages/logging` boundary: no bare `console.*` in `apps/api`, `apps/worker` or server-side apps/web code. Secrets ride as structured fields, redacted by path, never interpolated into `msg`.
- Every log line earns its level: `error` is operator-actionable now; `warn` is degraded or suspicious, alertable on sustained rate; `info` is a terse operational signal; otherwise `debug` or delete the line. First-class `evt` names come only from the taxonomy table in `docs/self-host/observability.md`.
- Default to no comment. A comment earns its place only by stating a constraint the code cannot show, concisely, at the owner it constrains: a real invariant, a status contract, an ordering guarantee, a browser bug. A rationale essay, a provenance block, or a restatement of the line below it does not, and those get deleted rather than shortened, because a one-line restatement is still a line between the reader and the code. Two rules hold the volume, catching different failures: `house/comment-run` caps one block at eight content lines, and `house/comment-density` caps a file at 40% comment, which is the shape a file takes when every statement gets its own one-liner. A block that genuinely earns more takes a scoped `oxlint-disable` with its reason. Comments carry no em-dash.
- Never cite a ticket id, ADR number, PR number or review-round name in any tracked file except `docs/adr/**`. Those references belong in the commit message and PR description.
- A test title names the behaviour in at most 70 characters, no em-dash, no parenthetical, `describe` included.
- The comment-run, comment-density, test-title and em-dash rules lint at error against `oxlint-suppressions.json`. A PR that edits a listed file clears that file's entries for the rules it trips and prunes the count.

## Gates

- oxlint is the only linter. A convention oxlint has no native rule for lives in the house JS plugin as a selector rule; user-facing copy is gated by eslint-plugin-i18next loaded through oxlint. Every deterministic rule runs at error.
- `.nvmrc` is the one node version: local shells and CI both read it, and `engines` states the range the boundary gate tolerates. A gate run on an out-of-range node fails with a message about the tool, not the requirement.
- Judge a gate by its exit code, never by grepping output (`pnpm lint` short-circuits on `&&`; prettier reports violations as `[warn]`). Run `cmd >/dev/null 2>&1; echo $?`. In stacked work lint each branch bottom-up; a rule can pass at the tip and fail mid-stack.
- Coverage floors ride inside `pnpm test`: every package's vitest config commits a lines threshold; 75% is the standard. A package still under it carries a temporary floor plus a catch-up ticket. Never lower a floor to absorb a drop. A `v8 ignore` comment needs a stated reason and is reviewed like a lint-disable.
- Generation-surface changes run the eval harness. The surface: `packages/brief-core/src/generation/prompt.ts`, the output schema, validators and salvage, repo-config injection, and output-affecting adapter defaults. Agents never invoke the harness; they prepare the case selection and its justification, and a human runs and spends. Scoped by default: one `pnpm -C tools/categorizer eval --case <id>` run per case whose properties could plausibly move, never a list, with the report in the PR body. Full suite for prompt-wide or model-bump changes. `--rebaseline` on main only when the surface legitimately moved. Convention gate, never CI. Mechanics in `tools/categorizer/eval/README.md`.
- Never search with a glob that can match a real env file; target `.env.example` and source files explicitly. A filename-list grep still reads contents, and real env files hold live keys: `tools/categorizer/.env` holds the live Anthropic key, gitignored and agent-denied.

## Review and runs

- Review by re-deriving, not by agreeing. Form your own read of a diff before reading the author's, then name the disagreements as reasoning gaps. A finding you believe is wrong gets a reply explaining why, not a compliance fix; a question is not a change request.
- One finding means a sweep: before replying to a review comment, fix every occurrence in the stack.
- A hands-off run never answers its own confirmation questions. Where a skill or a plan asks the owner something, such as commit strategy, which specialist skills apply, or a seam between phases, stop there and leave the question pending. Overnight or unattended framing widens the batch of work an agent may do; it never widens the set of decisions it may make alone.

## Debt register

Reviewer checklist for a standards PR: name the gate you ran and its exit code; report baseline entries retired by policy separately from violations actually fixed; say which owner the remaining debt belongs to; and justify a deviation from one of the three judgment calls in the PR body, never in a source comment.

| Debt | Measure now | Closes on |
| --- | --- | --- |
| Enforced-rule baselines in `oxlint-suppressions.json` | The file's own entries: `house/no-em-dash`, `house/test-title`, `house/comment-run` and `house/comment-density` | The file is deleted, one edited file at a time under the cleanup-on-edit rule |
| dependency-cruiser known violations | The root known-violations file, which only ever loses entries | The file is deleted |
| Support-file placement and casing migrations | Existing names are renamed on their own ticket | Their own tickets, not opportunistic diffs |
| Package coverage floors below 75% | Each such package carries a temporary floor plus a catch-up ticket | The floor reaches 75% |
