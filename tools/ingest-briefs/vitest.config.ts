import { defineConfig } from "vitest/config";

import {
  coverageExclude,
  coverageReporter,
  testIsolation,
} from "../../vitest.shared";

export default defineConfig({
  test: {
    ...testIsolation,
    coverage: {
      // Whole-tree measurement (see the shared note): untested modules must
      // count against the floor. Two exclusions, both process wiring like the
      // sibling packages' startup files: `main.ts` (env, argv, exit codes) and
      // the `gh` resolver, which is a subprocess boundary. The rest of
      // `src/cli` is pure and covered by `test/cli.test.ts`.
      include: ["src/**"],
      exclude: [...coverageExclude, "src/main.ts", "src/cli/repo-resolver.ts"],
      reporter: coverageReporter,
      thresholds: { lines: 75 },
    },
  },
});
