// The hosted demo: a static build of the app with no server behind it. Start's
// SPA mode prerenders one route-less shell, the demo client entry answers the
// API from the bundled fixtures, and `scripts/build-demo.ts` lays the output
// out for a static host.
import { defineConfig, mergeConfig } from "vite";

import { buildSharedViteConfig } from "./vite.shared";

/** Where the build lands before the script flattens it; `build:demo` owns the path. */
export const DEMO_OUT_DIR = "dist-demo";

/** The shell page, named so a host serves it for `/` without a rewrite. */
export const DEMO_SHELL_PAGE = "index";

export default defineConfig(
  mergeConfig(
    buildSharedViteConfig({
      spa: {
        enabled: true,
        prerender: { outputPath: `/${DEMO_SHELL_PAGE}`, crawlLinks: false },
      },
      client: { entry: "./demo/client.tsx" },
      server: { entry: "./demo/server.ts" },
    }),
    {
      build: { outDir: DEMO_OUT_DIR },
      define: { "import.meta.env.ENABLE_DEMO": JSON.stringify("true") },
    },
  ),
);
