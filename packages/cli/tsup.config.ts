// Single-file bundle: everything — commander, zod, the workspace `i18n`
// catalog — bundles into dist/mergebrief.js (compile-time `types` aside,
// i18n is the one workspace runtime dep).
// The shebang lives in src/bin.ts and survives the bundle.
import { defineConfig } from "tsup";

export default defineConfig({
  entry: { mergebrief: "src/bin.ts" },
  format: ["esm"],
  banner: {
    // CJS deps (commander) `require()` node builtins inside the ESM bundle.
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
  platform: "node",
  target: "node20",
  bundle: true,
  noExternal: [/.*/],
  clean: true,
  minify: false,
});
