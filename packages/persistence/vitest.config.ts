import { defineConfig } from "vitest/config";

import { coverageExclude, coverageReporter } from "../../vitest.shared";

export default defineConfig({
  test: {
    // Every test boots a fresh in-memory PGlite and runs the checked-in
    // migrations, which already sits close to the 5s default; v8 coverage
    // instrumentation pushes it over. Raising the specific timeout is the
    // structural fix the flake policy prescribes (ADR 0038 §2) — BRIEF-114
    // owns making the boot itself fast.
    testTimeout: 20_000,
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
