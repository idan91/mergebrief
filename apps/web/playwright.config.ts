// The seeded-database browser suite: Chromium against a production build of
// the web tier, an API process and a disposable postgres this harness owns.
// GitHub is stubbed inside the API process, so no live spend and no
// dev-database contact. Retries are the one carve-out from the no-retry flake
// policy: the browser layer is the one place a retry buys signal instead of
// hiding a bug.
import { defineConfig, devices } from "@playwright/test";
import {
  buildWebServerEnv,
  E2E_PORT,
  STORAGE_STATE_PATH,
} from "./e2e/harness/env";

/**
 * The specs that write to the seeded database: they archive or erase Inbox
 * rows, or open the viewer's review session on the fixture pull request.
 * Everything else only reads the seed, and some of it counts those rows.
 */
const MUTATING_SPECS = [
  "**/inboxArchive.e2e.ts",
  "**/inboxBulk.e2e.ts",
  "**/inboxDelete.e2e.ts",
  "**/review-from-changes.e2e.ts",
];

/**
 * A CI runner has four cores for the browsers, the web server, the API and
 * postgres. Two browsers leave the servers a core each; a third starves the
 * one process that renders every page.
 */
const CI_WORKERS = 2;
const CI_RETRIES = 2;
/** Playwright's own default, spelled out: half the machine's cores. */
const LOCAL_WORKERS = "50%";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  // Vitest's default include is `**/*.{test,spec}.*`, which `.e2e.ts` does
  // not match, the two runners cannot pick up each other's files, and
  // `e2e/` sits outside the `src/**` coverage include set.
  fullyParallel: true,
  workers: process.env["CI"] ? CI_WORKERS : LOCAL_WORKERS,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? CI_RETRIES : 0,
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
      // Every test gets its own browser context and none writes to the
      // database, so they run in any order on every worker.
      name: "readonly",
      use: devices["Desktop Chrome"],
      testIgnore: MUTATING_SPECS,
    },
    {
      // Starts once `readonly` has finished, on one worker in file order.
      // `--no-deps` runs one of these specs without the read-only ones first.
      // No retry: an erased row stays erased, so a second attempt at the
      // delete specs could only fail differently.
      name: "mutating",
      use: devices["Desktop Chrome"],
      testMatch: MUTATING_SPECS,
      dependencies: ["readonly"],
      fullyParallel: false,
      workers: 1,
      retries: 0,
    },
  ],
  // Only the web tier. The API is started by `globalSetup`, after the database
  // exists: Playwright starts and awaits every webServer entry BEFORE
  // globalSetup runs, and the API connects to Postgres before it listens.
  // `reuseExistingServer` is OFF: a reused process would proxy to another
  // run's API.
  webServer: [
    {
      // The production process over a fresh build, every run: a `dist/` left
      // by another branch must never be the code under test.
      command: "pnpm build && pnpm start",
      url: `http://localhost:${String(E2E_PORT)}/healthz`,
      reuseExistingServer: false,
      timeout: 120_000,
      stdout: "ignore",
      stderr: "pipe",
      env: buildWebServerEnv(),
    },
  ],
});
