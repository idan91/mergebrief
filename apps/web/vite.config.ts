/// <reference types="vitest/config" />
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

/** The deployment's own public hostname, from PUBLIC_BASE_URL; undefined
 * (→ vite's rebinding-guard defaults) when unset or unparseable. */
function previewAllowedHosts(): string[] | undefined {
  const base = process.env["PUBLIC_BASE_URL"];
  if (!base) {
    return undefined;
  }
  try {
    return [new URL(base).hostname];
  } catch {
    return undefined;
  }
}

export default defineConfig({
  test: {
    setupFiles: ["./src/test/setup.ts"],
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
  },
  preview: {
    // The compose web service serves REAL traffic through `vite preview`
    // behind a tunnel/reverse proxy, so Host headers carry the public domain
    // and vite's default preview allow-list (localhost/IP literals) would
    // 403 every webhook delivery and OAuth callback before they reach Hono.
    // Allow exactly the deployment's own public hostname — derived from
    // PUBLIC_BASE_URL (the same env the OAuth callback origin is built
    // from), read when `vite preview` loads this config. localhost and IP
    // literals stay allowed by vite regardless, so the compose healthcheck
    // (127.0.0.1) and local browsing are unaffected; an unset/invalid
    // PUBLIC_BASE_URL just keeps vite's rebinding-guard defaults.
    ...(() => {
      const hosts = previewAllowedHosts();
      return hosts ? { allowedHosts: hosts } : {};
    })(),
  },
  resolve: {
    alias: {
      "~": "/src",
    },
  },
  plugins: [tanstackStart(), viteReact()],
});
