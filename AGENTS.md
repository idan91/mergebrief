# code-review — repo-wide agent rules

This file is the canonical repo-standards file; the root `CLAUDE.md` is a
symlink to it. Package-specific conventions and invariants live in each
package's `AGENTS.md` (persistence, github, api, repo-config, logging,
apps/web). Rules here apply to the whole workspace.

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
- **Logging goes through the `packages/logging` seam** (ADR 0034) — no bare
  `console.*` in `packages/api`, `packages/worker`, or server-side
  `apps/web` code. Secrets ride as structured fields (redacted by path),
  never interpolated into `msg`.
- **Every log line earns its level** (ADR 0034 #5): `error` =
  operator-actionable now; `warn` = degraded/suspicious, alertable on
  sustained rate; `info` = terse operational signal; otherwise `debug` or
  delete the line. First-class `evt` names come ONLY from the ADR 0034
  taxonomy table — everything else stays plain leveled logging.
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
