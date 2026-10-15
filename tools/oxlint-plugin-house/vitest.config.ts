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
      include: ["src/**"],
      exclude: coverageExclude,
      reporter: coverageReporter,
      thresholds: { lines: 75 },
    },
  },
});
