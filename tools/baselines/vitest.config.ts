import { defineConfig } from "vitest/config";

import { coverageExclude, coverageReporter } from "../../vitest.shared";

export default defineConfig({
  test: {
    coverage: {
      // Whole-tree measurement: an untested module must count against the
      // floor. `main.ts` is argv, env and exit-code wiring, exercised through
      // the subprocess case rather than measured here.
      include: ["src/**"],
      exclude: [...coverageExclude, "src/main.ts"],
      reporter: coverageReporter,
      thresholds: { lines: 75 },
    },
  },
});
