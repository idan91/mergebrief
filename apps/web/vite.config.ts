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
  resolve: {
    alias: {
      "~": "/src",
    },
  },
  plugins: [tanstackStart(), viteReact()],
});
