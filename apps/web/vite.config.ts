/// <reference types="vitest/config" />
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

import {
  coverageExclude,
  coverageReporter,
  testIsolation,
} from "../../vitest.shared";

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

export default defineConfig({
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
  css: {
    preprocessorOptions: {
      scss: {
        loadPaths: ["src/styles"],
      },
    },
  },
  server: {
    port: 3000,
    allowedHosts: resolveDevAllowedHosts(),
  },
  // The token worker code-splits one chunk per grammar, so it must ship as an
  // ES module; vite's default iife worker format cannot carry a dynamic import.
  worker: { format: "es" },
  // The dependency scan never follows `new Worker(new URL(...))`, so a graph
  // reachable only from a worker stays unscanned: a cold dev server then
  // discovers it on the first brief visit, re-optimizes and full-reloads the
  // page. Every worker entry is listed here; these concatenate with the
  // client and router entries TanStack Start sets for the client environment.
  optimizeDeps: {
    entries: ["src/utils/diffTokens/worker.ts"],
  },
  resolve: {
    alias: {
      "@web": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // Vite only exposes VITE_* to the client. ENABLE_* joins it as the
  // feature-flag namespace, so a flag reads the same on the server and in
  // the browser. Boolean toggles ONLY: everything matching this prefix is
  // inlined into the client bundle, so a secret must never be named ENABLE_*.
  envPrefix: ["VITE_", "ENABLE_"],

  plugins: [svgr(), tanstackStart(), viteReact()],
});
