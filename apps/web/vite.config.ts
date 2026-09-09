/// <reference types="vitest/config" />
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import svgr from "vite-plugin-svgr";

import { coverageExclude, coverageReporter } from "../../vitest.shared";

/** The deployment's own public hostname, from PUBLIC_BASE_URL; undefined
 * (→ vite's rebinding-guard defaults) when unset or unparseable. */
function previewAllowedHosts(): string[] | undefined {
  const base = [process.env["PUBLIC_BASE_URL"], "http://localhost:3000"];

  if (!base || base.length === 0) {
    return undefined;
  }
  try {
    return base
      .filter((url): url is string => !!url)
      .map((url) => new URL(url).hostname);
  } catch {
    return undefined;
  }
}

export default defineConfig({
  test: {
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
    // Same tunnel posture as `preview` below: the webhook dev loop serves
    // the DEV server through ngrok, so the public hostname (derived from
    // PUBLIC_BASE_URL) must clear vite's host guard here too.
    ...(() => {
      const hosts = previewAllowedHosts();
      return hosts ? { allowedHosts: hosts } : {};
    })(),
  },
  preview: {
    // `vite preview` serves REAL traffic behind a tunnel or reverse proxy, so
    // Host carries the public domain and vite's default preview allow-list of
    // localhost and IP literals would 403 every webhook delivery and OAuth
    // callback. Allow exactly this deployment's own public hostname, derived
    // from PUBLIC_BASE_URL, the same env the OAuth callback origin is built
    // from. Localhost and IP literals stay allowed regardless, so the
    // healthcheck and local browsing are unaffected, and an unset or invalid
    // value keeps vite's rebinding-guard defaults.
    ...(() => {
      const hosts = previewAllowedHosts();
      return hosts ? { allowedHosts: hosts } : {};
    })(),
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
