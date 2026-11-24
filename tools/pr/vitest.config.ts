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
      // `main.ts` is argv, process and exit-code wiring only.
      include: ["src/**"],
      exclude: [...coverageExclude, "src/main.ts"],
      reporter: coverageReporter,
      thresholds: { lines: 75 },
    },
  },
});
