// E2E v1 (ADR 0038 §4, BRIEF-113): the unauthenticated dummy-brief suite.
// Chromium only, single worker, hermetic — no DB, no GitHub, no live spend,
// so it runs on fork PRs. Retries here are the ADR's single carve-out from
// the no-retry flake policy: the browser layer is the one place a retry
// buys signal instead of hiding a bug.
import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

/**
 * The committed fixture artifact set the web server is booted over
 * (`MERGEBRIEF_OUT_DIR`). Pointing the reader at this directory instead of
 * copying files into `tools/categorizer/out` keeps the run hermetic in both
 * directions: the suite sees only these artifacts (a developer's generated
 * briefs cannot change what the timeline or picker renders), and the run
 * never writes into a directory a developer owns.
 */
const FIXTURE_OUT_DIR = fileURLToPath(
  new URL("./e2e/fixtures/briefs", import.meta.url),
);

/** Dedicated port: never the dev server's 3000, so a running `pnpm dev` neither collides nor gets reused. */
const PORT = 3311;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.e2e.ts",
  // Vitest's default include is `**/*.{test,spec}.*`, which `.e2e.ts` does
  // not match — the two runners cannot pick up each other's files, and
  // `e2e/` sits outside the `src/**` coverage include set.
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  reporter: process.env["CI"]
    ? [["github"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  projects: [{ name: "chromium", use: devices["Desktop Chrome"] }],
  webServer: {
    // The real server entry (`src/server.ts`) in dev mode: same request
    // pipeline as production for `/briefs/*`, without paying a full build
    // per CI run. `reuseExistingServer` is OFF unconditionally — a reused
    // server would be missing `MERGEBRIEF_OUT_DIR` and serve the wrong
    // artifacts.
    command: `pnpm exec vite dev --port ${String(PORT)} --strictPort`,
    url: `http://localhost:${PORT}/healthz`,
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
    env: { MERGEBRIEF_OUT_DIR: FIXTURE_OUT_DIR },
  },
});
