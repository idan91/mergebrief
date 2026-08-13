// Perf measurement harness: boots the same hermetic server as the e2e suite
// but over the GENERATED large fixture, and runs only the `*.perf.ts` specs.
// Local instrument, not a CI gate — numbers land in PR bodies.
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig, devices } from "@playwright/test";

const GENERATED_OUT_DIR = fileURLToPath(
  new URL("./e2e/perf/generated", import.meta.url),
);

// Fail before boot, not 30s into the first spec: a missing fixture dir would
// serve an empty brief list (`ENOENT` reads as zero briefs, /healthz passes)
// and every measurement would time out against a not-found page.
if (!existsSync(GENERATED_OUT_DIR)) {
  throw new Error(
    `Generated perf fixture missing at ${GENERATED_OUT_DIR} — run \`pnpm perf:fixture\` first.`,
  );
}

/** Dedicated port: collides with neither dev (3000) nor e2e (3311). */
const PORT = 3313;

export default defineConfig({
  testDir: "./e2e/perf",
  testMatch: "**/*.perf.ts",
  fullyParallel: false,
  workers: 1,
  // Never retry a measurement: a retried sample is a hidden outlier.
  retries: 0,
  reporter: [["list"]],
  // Generous per-test budget: each test takes many timed samples.
  timeout: 180_000,
  use: {
    baseURL: `http://localhost:${String(PORT)}`,
    trace: "off",
  },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: {
    command: `pnpm exec vite dev --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${String(PORT)}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    env: { MERGEBRIEF_OUT_DIR: GENERATED_OUT_DIR },
  },
});
