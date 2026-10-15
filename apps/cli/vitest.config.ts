import { readFileSync } from "node:fs";
import { defineConfig } from "vitest/config";

import {
  coverageExclude,
  coverageReporter,
  testIsolation,
} from "../../vitest.shared";

/** Command tests boot the API as its own process; under `pnpm -r test`
 * contention that outlasts the 5s test and 10s hook defaults. */
const API_HARNESS_TIMEOUT_MS = 20_000;

const pkg: { version: string } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

export default defineConfig({
  define: { __CLI_VERSION__: JSON.stringify(pkg.version) },
  test: {
    ...testIsolation,
    // Warms the migrated-PGlite snapshot before the workers fork; see the file.
    globalSetup: ["./test/global-setup.ts"],
    testTimeout: API_HARNESS_TIMEOUT_MS,
    hookTimeout: API_HARNESS_TIMEOUT_MS,
    coverage: {
      // Whole-tree measurement: without an explicit `include`, vitest 4 only
      // reports files a test happened to import, so untested modules would
      // not count against the floor at all.
      include: ["src/**"],
      exclude: coverageExclude,
      reporter: coverageReporter,
      thresholds: { lines: 75 },
    },
  },
});
