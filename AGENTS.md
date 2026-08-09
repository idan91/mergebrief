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
- **Package entry = `src/index.ts`** — a curated barrel, the package's
  `exports["."]` target (BRIEF-90; extends ADR 0037 decision 1 to package
  trees). A package root conforms when every file is the entry, `types.ts`,
  or a small domain-cued support file (loose count ≤ ~5); a category earns a
  folder only when it clarifies; generic names are defects. `index.tsx`
  feature barrels remain an apps/web convention (ADR 0037).
- **Logging goes through the `packages/logging` seam** (ADR 0034) — no bare
  `console.*` in `packages/api`, `packages/worker`, or server-side
  `apps/web` code. Secrets ride as structured fields (redacted by path),
  never interpolated into `msg`.
- **Every log line earns its level** (ADR 0034 #5): `error` =
  operator-actionable now; `warn` = degraded/suspicious, alertable on
  sustained rate; `info` = terse operational signal; otherwise `debug` or
  delete the line. First-class `evt` names come ONLY from the ADR 0034
  taxonomy table — everything else stays plain leveled logging.
- **Coverage floors ride inside `pnpm test`** (ADR 0038 §3): every package's
  vitest config commits a lines threshold — 75% is the standard, and a package
  still under it carries a temporary floor plus a catch-up ticket. Never lower
  a floor to absorb a drop. A `v8 ignore` comment needs a stated reason, and is
  reviewed like a lint-disable.
- **CI is path-filtered per package**: changing a contract another package
  consumes (parser shapes, route bodies, exported types) does NOT run the
  dependents' suites in CI — run them locally before pushing. (BRIEF-23: a
  github parser change broke two api tests under a green CI.)
- **Comments stay lean and reference-free**: a comment earns its place only
  by stating a constraint the code can't show on its own — one short line,
  not a paragraph. Delete rationale essays, "why we chose X" writeups, and
  provenance blocks. Never cite a ticket id, ADR number, PR number, or
  review-round name in a comment or in narrative docs (`docs/plans/**`,
  `README.md`, `CONTEXT.md`, `PRODUCT.md`, any `AGENTS.md`) — that
  belongs in the commit message and PR description, and rots once the
  ticket closes. `docs/adr/**` is the one exception: an ADR's own number
  and its citations of other ADRs/tickets ARE the document's identity.
- **Generation-surface changes run the eval harness** (BRIEF-59): touching
  `packages/brief-core/src/generation/prompt.ts`, the output schema, validators/salvage,
  repo-config injection, or output-affecting adapter defaults ⇒ run
  `pnpm -C tools/categorizer eval`, **scoped by default** (BRIEF-87):
  one `--case <id>` run per case whose properties could plausibly move
  (the flag takes a single id), justify the selection in the PR body;
  full suite (measured $9.70, 2026-07-25) for prompt-wide or model-bump
  changes. Compares against the committed baselines; `--rebaseline` on
  main only when the surface legitimately moved. Include the report in
  the PR body. Convention gate, never CI — live API spend. See
  `tools/categorizer/eval/README.md`.
