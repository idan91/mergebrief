// Coverage policy shared by every package suite. Only the
// exclusion set is shared — the lines threshold stays in each package's own
// vitest config, because the floors differ while the debt is paid down.
//
// Vitest appends test files, setup files, config files and node_modules to
// `coverage.exclude` itself, so this list carries only the policy exclusions.

/** Terminal summary only. The floor gate reads the numbers off stdout, so
 * writing html + clover + json reports in every package on every `pnpm test`
 * is pure cost in the agent loop. To browse the annotated report instead:
 * `pnpm -C <pkg> test --coverage.reporter=html`. */
export const coverageReporter = ["text"];

/** Files with no testable behaviour: generated artifacts, ambient
 * declarations, and the re-export-only package entry barrel. Anything else
 * that wants out of coverage uses a `v8 ignore` comment WITH a stated
 * reason. */
export const coverageExclude = [
  // Generated artifacts — drizzle migration output, `routeTree.gen.ts`, and
  // any other `*.gen.*` emitted file.
  "**/drizzle/**",
  "**/*.gen.*",
  // `**/types.ts` is deliberately NOT excluded. Under types-owner-first
  // a domain's `types.ts` owns its Zod parsers and brand guards
  // alongside the shapes — real runtime code that must count against the
  // floor. A genuinely type-only module compiles to nothing and v8 reports
  // it as 0/0 lines (100%), so excluding the pattern would buy nothing and
  // hide the parsers.
  // Ambient declarations, on the other hand, are never emitted at all.
  "**/*.d.ts",
  // The package entry barrel — re-exports only, no behaviour.
  "src/index.ts",
  // Not source at all; the uncovered-file scan otherwise tries to parse it
  // and logs a rolldown error per stray file.
  "**/.DS_Store",
];
