// Single-file bundle (ADR 0028 #6): everything — commander, zod — bundles
// into dist/mergebrief.js; no workspace runtime deps (compile-time `types`
// only). The shebang lives in src/bin.ts and survives the bundle.
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
