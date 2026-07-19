# code-review — repo-wide agent rules

Package-specific conventions and invariants live in each package's
`AGENTS.md` (persistence, github, api, repo-config, apps/web). Rules here apply to the
whole workspace.

- **Extensionless relative imports everywhere** (`from "./tenant"`, never
  `from "./tenant.js"`). Every package is bundler-resolved end to end
  (`moduleResolution: "bundler"`; vitest/tsx/vite). Extensions only where
  genuinely required (non-TS assets).
- No `enum`: `as const` maps + `ValueOf<T>`; keys SHOUT_CASE, string values
  kebab-case.
- Strict TS: no `any`, no bare `as` — Zod or type guards at boundaries.
- Expected failures return `Result`; `throw` is for programmer/infra errors.
  Error messages never carry secrets, tokens, or connection strings.
- Named exports only (default exports only where a framework requires them).
- **CI is path-filtered per package**: changing a contract another package
  consumes (parser shapes, route bodies, exported types) does NOT run the
  dependents' suites in CI — run them locally before pushing. (BRIEF-23: a
  github parser change broke two api tests under a green CI.)
- **Generation-surface changes run the eval harness** (BRIEF-59): touching
  `packages/brief-core/src/prompt.ts`, the output schema, validators/salvage,
  repo-config injection, or output-affecting adapter defaults ⇒ run
  `pnpm -C tools/categorizer eval` (compares against the committed
  baselines; `--rebaseline` on main only when the surface legitimately
  moved) and include the report in the PR body. Convention gate, never
  CI — live API spend. See `tools/categorizer/eval/README.md`.
