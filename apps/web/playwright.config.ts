// E2E v2: the seeded-database suite over the repo route.
// Chromium only, single worker, network-free. GitHub is stubbed inside the
// server process and postgres is a disposable container this harness owns,
// so no live spend and no dev-database contact. Retries are the ADR's single
// carve-out from the no-retry flake policy: the browser layer is the one
// place a retry buys signal instead of hiding a bug.
import { defineConfig, devices } from "@playwright/test";
import {
  buildWebServerEnv,
  E2E_PORT,
  STORAGE_STATE_PATH,
} from "./e2e/harness/env";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  // Vitest's default include is `**/*.{test,spec}.*`, which `.e2e.ts` does
  // not match, the two runners cannot pick up each other's files, and
  // `e2e/` sits outside the `src/**` coverage include set.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  globalSetup: "./e2e/harness/globalSetup.ts",
  globalTeardown: "./e2e/harness/globalTeardown.ts",
  use: {
    baseURL: `http://localhost:${String(E2E_PORT)}`,
    trace: "on-first-retry",
    // The seeded session's cookie, every page is a signed-in viewer.
    storageState: STORAGE_STATE_PATH,
  },
  projects: [
    {
      name: "chromium",
      use: devices["Desktop Chrome"],
      testIgnore: "**/signedOut.e2e.ts",
    },
    {
      // No storage state: the one project that arrives without a session.
      name: "signed-out",
      use: {
        ...devices["Desktop Chrome"],
        storageState: { cookies: [], origins: [] },
      },
      testMatch: "**/signedOut.e2e.ts",
    },
  ],
  // Both tiers, in order: the API owns the database and the credentials, the
  // web app proxies `/api/*` to it. `reuseExistingServer` is OFF
  // unconditionally on both, a reused process would be composed over the
  // wrong database and without the GitHub stub.
  // Only the web tier. The API is started by `globalSetup`, after the database
  // exists: Playwright starts and awaits every webServer entry BEFORE
  // globalSetup runs, and the API connects to Postgres before it listens.
  webServer: [
    {
      // The real server entry (`src/server.ts`) in dev mode: same request
      // pipeline as production, without paying a full build per run.
      command: `pnpm exec vite dev --port ${String(E2E_PORT)} --strictPort`,
      url: `http://localhost:${String(E2E_PORT)}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
      env: buildWebServerEnv(),
    },
  ],
});
