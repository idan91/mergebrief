import { defineConfig } from "vitest/config";

import { coverageExclude, coverageReporter } from "../../vitest.shared";

export default defineConfig({
  test: {
    coverage: {
      include: ["src/**"],
      exclude: coverageExclude,
      reporter: coverageReporter,
      thresholds: { lines: 75 },
    },
  },
});
