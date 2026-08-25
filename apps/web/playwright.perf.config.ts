// Perf measurement harness: the same seeded-database server as the e2e
// suite, booted over the GENERATED large fixture, running only `*.perf.ts`.
// Local instrument, not a CI gate — numbers land in PR bodies. The suite
// overrides come in through env (see `perf:measure` in package.json).
import { existsSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";
import {
  buildWebServerEnv,
  E2E_PORT,
  FIXTURE_DIR,
  STORAGE_STATE_PATH,
} from "./e2e/harness/env";

// Fail before boot, not 30s into the first spec: a missing fixture dir would
// seed nothing and every measurement would time out on a not-found page.
if (!existsSync(FIXTURE_DIR)) {
  throw new Error(
    `Generated perf fixture missing at ${FIXTURE_DIR} — run \`pnpm perf:fixture\` first.`,
  );
}

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
  globalSetup: "./e2e/harness/globalSetup.ts",
  globalTeardown: "./e2e/harness/globalTeardown.ts",
  use: {
    baseURL: `http://localhost:${String(E2E_PORT)}`,
    trace: "off",
    storageState: STORAGE_STATE_PATH,
  },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: {
    command: `pnpm exec vite dev --port ${String(E2E_PORT)} --strictPort`,
    url: `http://localhost:${String(E2E_PORT)}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    env: buildWebServerEnv(),
  },
});
