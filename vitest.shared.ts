/** Terminal summary only: the floor gate reads the numbers off stdout. Browse
 * the annotated report with `pnpm -C <pkg> test --coverage.reporter=html`. */
export const coverageReporter = ["text"];

/** Files with no testable behaviour. Vitest itself excludes tests, setup and
 * config files and node_modules; anything else takes a `v8 ignore` comment
 * with a stated reason. */
export const coverageExclude = [
  "**/drizzle/**",
  "**/*.gen.*",
  // Not `**/types.ts`: a domain's types file owns runtime Zod parsers.
  "**/*.d.ts",
  "src/index.ts",
  // The uncovered-file scan logs a rolldown error per stray file otherwise.
  "**/.DS_Store",
];

/** Applied before every test, ahead of its `beforeEach`, so a spy or stub
 * made at module scope or in `beforeAll` is gone by the first test.
 * `restoreMocks` restores `vi.spyOn` spies only; a `vi.fn()` keeps its calls. */
export const testIsolation = {
  restoreMocks: true,
  unstubGlobals: true,
  unstubEnvs: true,
};
