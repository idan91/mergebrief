/// <reference types="vitest/config" />
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

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
    // behind a tunnel/reverse proxy, so Host headers carry the public domain.
    // Vite's default preview allow-list (localhost/IP literals) would 403
    // every webhook delivery and OAuth callback before they reach Hono.
    // Safe to open: the published port binds loopback-only in compose, and
    // anything internet-facing sits behind the operator's proxy anyway.
    allowedHosts: true,
  },
  resolve: {
    alias: {
      "~": "/src",
    },
  },
  plugins: [tanstackStart(), viteReact()],
});
