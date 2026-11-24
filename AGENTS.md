# Repo-wide agent rules

This file and `docs/dev/coding-standards.md` are the canonical repo standards; the root `CLAUDE.md` is a symlink to this file. Rules in both apply to the whole workspace. A rule lives at the level that owns it: member files refine, never restate. A member carries an `AGENTS.md` when it has conventions neither states, plus a pointer `CLAUDE.md` that loads it; a new file adds both, a deleted file removes both.

Every rule in both binds as written, casing, schema placement, package edges and export shape included. Where a rule names a gate, that gate enforces it, and a red gate blocks the PR. The standards doc opens with the three rules that are judgment calls instead.

`## Debt register` lists the migrations still in flight. A file listed there is not a reason to widen the diff you are already writing: that debt is fixed on its own ticket.

## Workspace

- `apps/` holds members that run as their own process or ship as their own binary or site (`web`, `api`, `worker`, `cli`, `docs-site`). `packages/` holds code apps share. `tools/` holds repo-local scripts, never deployed, never imported by app or package source (`no-source-imports-a-tool`); they run by hand or by CI/lint. Nothing imports an app, tests included: apps talk over HTTP or the Postgres job queue. The HTTP contract between apps is `packages/contract`, which both sides import. `no-app-imports-another-app` holds this at error over an unsuppressed graph; there is no baseline, and `check:baselines` refuses one being re-created.
- Package edges: `types` imports no workspace package; `logging`, `i18n` and `generators` import only `types`; `api` never imports `cli`, `worker` or `web`. `apps/web` reaches the API over HTTP and shares its shapes through `contract`; it imports the API package nowhere, tests included.
- `packages/contract` is the HTTP agreement between apps that run as their own process: wire vocabulary and response shapes only, no handler, no middleware, no database access, no re-export of an app. Its source imports only `types`, which holds the stored vocabularies a payload field is typed by; `contract-imports-no-runtime` holds that at error, because apps/web reaches it through an isomorphic module and a `persistence` import would pull drizzle into the browser bundle.
- `packages/types` has zero dependencies. It holds type helpers (`ValueOf`, `Result`, `Brand` and kin), two cross-package shapes no single domain owns (`GenerateJobPayload`, `DraftPolicy`), the payload shapes that ride a wire vocabulary (`DispositionEvidence`, `GenerationErrorParams`), and `as const` maps for closed vocabularies two packages both need as values, or whose `ValueOf` type is needed by a package that must not depend on the map's owner. Domain types stay with their domain. Runtime is those maps only: no functions, no classes, no other values. `house/types-const-maps` holds that in `packages/types/**`.
- A value two packages both need moves to the nearest package both already depend on, under a domain subfolder. Shapes, type helpers (`ValueOf`), and `as const` maps for closed vocabularies those packages both need as values go to `packages/types`. A new package is the exception, not the default, and names its reason.
- Config enters via injection at the composition root; nothing else reads `process.env`. A member that consumes config names its composition root in its own `AGENTS.md`.
- CI selects changed packages plus their dependents (`--filter "...[<base>]"` off the real workspace graph). One hole needs a local run before pushing: an agreement that is not a package edge, such as a wire shape a separate service parses.

## Imports and exports

- Package imports use the package root or a subpath its `exports` declares. Feature imports in apps/web use the feature index or one segment below it, which for a support folder means its curated `index.ts`. dependency-cruiser runs unsuppressed, so a new violation is a red gate rather than a baseline entry.
- Extensionless relative imports everywhere (`from "./tenant"`, never `from "./tenant.js"`); every package is bundler-resolved end to end. Extensions only for non-TS assets.
- One import statement per package; no star imports; no aliasing an enum-like map on import; no deep import into another package's internals.
- Import the owner: never re-declare an existing exported type, schema, regex or fixture inline. Shared test fixtures live in test utils.
- Re-export only from a barrel: a file named `index.ts` or `index.tsx` may re-export files inside its own folder. A path that climbs out (`../`) or names another package is not a barrel re-export, even from an `index.ts`. Everywhere else, import from the owner. Passing an imported name on in any other form counts too: an exported alias, `export default`, `export =`, `export import`, a namespace member, an `import()` type, or an empty interface that only extends it. A justified exception carries `// oxlint-disable-next-line house/no-re-export -- <why>` and is argued in the PR. `house/no-re-export` holds it at error.
- Named exports only. Default exports exist only where a framework reads one: vite, vitest, tsup, drizzle and playwright configs, playwright's global setup and teardown, the oxlint plugin entry, the VitePress config and theme entry under `apps/docs-site/.vitepress/`, and the TanStack Start server entries `apps/web/src/server.ts` and `apps/web/src/demo/server.ts`. Controllers and handlers are named exports.
- `zod` is imported as `zod/v4`; `no-restricted-imports` holds it at error.

## Coding standards

`docs/dev/coding-standards.md` holds the judgment and style rules. To review, read it whole. To implement, read a section before the work it names:

- **File shape**: adding, splitting or renaming a file or folder, or placing a Zod schema.
- **Types and values**: declaring a type or a vocabulary map, changing a stored shape, or choosing how a function reports absence or failure.
- **Functions and naming**: writing a function or introducing a name.
- **Copy, logging and comments**: writing user-facing copy, a log line, a comment or a test title.
- **Review conduct**: reviewing a diff or replying to a review comment.

## Gates

- oxlint is the only linter. A convention oxlint has no native rule for lives in the house JS plugin as a selector rule; user-facing copy is gated by eslint-plugin-i18next loaded through oxlint. Every deterministic rule runs at error.
- The baseline file, `oxlint-suppressions.json`, only ever loses entries, and a file a PR edits leaves none behind: `pnpm check:baselines` holds it, inside `pnpm lint`. It compares the WORKING TREE against `merge-base(<base>, HEAD)`; the base is `--base`, else `MERGEBRIEF_BASELINE_BASE`, else `main`. A base it cannot resolve fails the gate rather than passing quietly, and its report splits retired entries into fixed, retired-by-policy and file-deleted so a green run is not read as more progress than it is.
- The comment-run, comment-density, test-title and em-dash rules lint at error against `oxlint-suppressions.json`. A PR that edits a listed file clears that file's entries for the rules it trips and prunes the count.
- `.nvmrc` is the one node version: local shells and CI both read it, the Dockerfile's `NODE_IMAGE` default restates it by hand, and `engines` states the range the boundary gate tolerates. A gate run on an out-of-range node fails with a message about the tool, not the requirement.
- Judge a gate by its exit code, never by grepping output (`pnpm lint` short-circuits on `&&`; prettier reports violations as `[warn]`). Run `cmd >/dev/null 2>&1; echo $?`. In stacked work lint each branch bottom-up; a rule can pass at the tip and fail mid-stack.
- Coverage floors ride inside each member's own `pnpm -C <member> test`; root `pnpm test` runs only `tools/categorizer`. Every tested member's vitest config (apps/web's `vite.config.ts`) commits a lines threshold; 75% is the standard. A package still under it carries a temporary floor plus a catch-up ticket. Never lower a floor to absorb a drop. A `v8 ignore` comment needs a stated reason and is reviewed like a lint-disable.
- Generation-surface changes run the eval harness. The surface: `packages/brief-core/src/generation/prompt/`, the output schema, validators and salvage, the anchored plan and stitch in `packages/brief-core/src/anchoring/` with the diff parsers in `packages/brief-core/src/diff/` that decide them, repo-config injection, and output-affecting adapter defaults. Agents never invoke the harness; they prepare the case selection and its justification, and a human runs and spends. Scoped by default: one `pnpm -C tools/categorizer eval --case <id>` run per case whose properties could plausibly move, never a list, with the report in the PR body. Full suite for prompt-wide or model-bump changes. `--rebaseline` on main only when the surface legitimately moved. Convention gate, never CI. Mechanics in `tools/categorizer/eval/README.md`.
- Never search with a glob that can match a real env file; target `.env.example` and source files explicitly. A filename-list grep still reads contents, and real env files hold live keys. `tools/categorizer/.env` is gitignored; deny your agent reads of it.

## Unattended runs

An unattended agent run never answers its own confirmation questions. Where a step asks the maintainer to decide something, stop there and leave the question pending. Unattended framing widens the batch of work an agent may do; it never widens the set of decisions it may make alone.

## Tickets and citations

A `BRIEF-nnn` reference names a ticket on the maintainers' private board. Outside work is tracked in GitHub Issues.

Cite ticket ids, PR numbers and review-round names only in commit messages, PR descriptions and the board. Authored text names a decision by what it decides, never by an ADR number; captured data such as eval fixtures stays as captured. A citation a tracked file truly needs is argued in the PR body.

## Debt register

Reviewer checklist for a standards PR: name the gate you ran and its exit code; report baseline entries retired by policy separately from violations actually fixed; say which owner the remaining debt belongs to; and justify a deviation from one of the three judgment calls in the PR body, never in a source comment.

| Debt | Measure now | Closes on |
| --- | --- | --- |
| Enforced-rule baselines in `oxlint-suppressions.json` | The file's own entries for `house/no-em-dash`, `house/test-title`, `house/comment-run` and `house/comment-density`. `pnpm check:baselines` prints the count and holds the promise | The file is deleted, one edited file at a time under the cleanup-on-edit rule |
| Support-file placement and casing migrations | Existing names are renamed on their own ticket | Their own tickets, not opportunistic diffs |
| Package coverage floors below 75% | Each such package carries a temporary floor plus a catch-up ticket | The floor reaches 75% |
