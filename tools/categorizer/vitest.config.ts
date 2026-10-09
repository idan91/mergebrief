import { defineConfig } from "vitest/config";

import { coverageExclude, coverageReporter } from "../../vitest.shared";

export default defineConfig({
  test: {
    coverage: {
      // `eval/cases/` and `eval/pair-cases/` are fixtures, not code, and would
      // swamp the number. `scripts/` holds one-shot live-API probes no test
      // can exercise.
      include: ["eval/*.ts", "src/**/*.ts"],
      exclude: coverageExclude,
      reporter: coverageReporter,
      // TEMPORARY floor: the standard is 75, and a catch-up ticket owns
      // raising it. Never lower this to absorb a drop.
      thresholds: { lines: 60 },
    },
  },
});
