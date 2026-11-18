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
      // `eval/cases/` and `eval/pair-cases/` are fixtures, not code, and would
      // swamp the number. `scripts/` holds one-shot live-API probes no test
      // can exercise.
      include: ["eval/*.ts", "src/**/*.ts"],
      exclude: coverageExclude,
      reporter: coverageReporter,
      thresholds: { lines: 75 },
    },
  },
});
