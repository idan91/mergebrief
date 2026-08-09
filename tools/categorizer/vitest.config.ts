import { defineConfig } from "vitest/config";

import { coverageExclude, coverageReporter } from "../../vitest.shared";

export default defineConfig({
  test: {
    coverage: {
      // This package has no `src/`: the harness modules in `eval/` are its
      // real surface. `eval/cases/` is out — those are fixtures, not code, and
      // counting them would swamp the number. `scripts/` is out too: one-shot
      // live-API probes no test can exercise.
      include: ["eval/*.ts"],
      exclude: coverageExclude,
      reporter: coverageReporter,
      // TEMPORARY floor: the standard is 75, but this package measured 60.8%
      // and a floor cannot be set above what already passes. A catch-up ticket
      // owns raising it — never lower this to absorb a drop.
      thresholds: { lines: 60 },
    },
  },
});
