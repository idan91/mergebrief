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
      // `main.ts` is argv and exit-code wiring, exercised through the
      // subprocess case rather than measured here.
      include: ["src/**"],
      exclude: [...coverageExclude, "src/main.ts"],
      reporter: coverageReporter,
      thresholds: { lines: 75 },
    },
  },
});
