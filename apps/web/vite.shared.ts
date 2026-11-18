import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import type { UserConfig } from "vite";
import svgr from "vite-plugin-svgr";

type StartOptions = Parameters<typeof tanstackStart>[0];

/**
 * Everything the production build and the demo build share; each config adds
 * its own server, test and Start options on top.
 */
export function buildSharedViteConfig(start?: StartOptions): UserConfig {
  return {
    css: {
      preprocessorOptions: {
        scss: {
          loadPaths: ["src/styles"],
        },
      },
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
    plugins: [svgr(), tanstackStart(start), viteReact()],
  };
}
