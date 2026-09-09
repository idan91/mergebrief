import { defineConfig } from "vitest/config";

import { coverageExclude, coverageReporter } from "../../vitest.shared";

export default defineConfig({
  test: {
    coverage: {
      // Whole-tree measurement: an untested module must count against the
      // floor. Most of this package is declarations, which v8 reports as
      // 0/0 lines; the maps carry the measurable behaviour.
      include: ["src/**"],
      exclude: coverageExclude,
      reporter: coverageReporter,
      thresholds: { lines: 75 },
    },
  },
});
