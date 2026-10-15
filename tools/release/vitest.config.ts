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
      // Whole-tree measurement: an untested module must count against the
      // floor. `main.ts` is argv and exit-code wiring, exercised by hand.
      include: ["src/**"],
      exclude: [...coverageExclude, "src/main.ts"],
      reporter: coverageReporter,
      thresholds: { lines: 75 },
    },
  },
});
