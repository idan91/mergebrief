/// <reference types="vitest/config" />
import { defineConfig, mergeConfig } from "vite";

import {
  coverageExclude,
  coverageReporter,
  testIsolation,
} from "../../vitest.shared";
import { buildSharedViteConfig } from "./vite.shared";

/** The dev server's allowed hosts: localhost plus PUBLIC_BASE_URL's hostname
 * when it parses, so the webhook dev loop clears vite's host guard through a
 * tunnel. Production serves through `src/serve.ts`, which owns its own guard. */
function resolveDevAllowedHosts(): string[] {
  const hosts = ["localhost"];
  const publicBaseUrl = process.env["PUBLIC_BASE_URL"];
  if (publicBaseUrl === undefined || publicBaseUrl === "") {
    return hosts;
  }
  try {
    hosts.push(new URL(publicBaseUrl).hostname);
  } catch {
    // An unparseable value adds nothing; localhost stays allowed.
  }
  return hosts;
}

export default defineConfig(
  mergeConfig(buildSharedViteConfig(), {
    test: {
      ...testIsolation,
      setupFiles: ["./src/test/setup.ts"],
      // The route suites render a real router under jsdom and legitimately take
      // seconds. `pnpm -r test` runs every package's workers at once, and under
      // that contention the 5s default times a passing test out; the failure
      // then leaks a mounted DOM into the next test's queries, so one slow
      // machine reads as a cascade of unrelated assertion failures.
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
    server: {
      port: 3000,
      allowedHosts: resolveDevAllowedHosts(),
    },
  }),
);
