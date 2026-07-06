# code-review — repo-wide agent rules

Package-specific conventions and invariants live in each package's
`AGENTS.md` (persistence, github, api). Rules here apply to the whole
workspace.

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
