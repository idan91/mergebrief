// Single-file bundle: everything, commander, zod and the workspace `i18n`
// catalog included, bundles into dist/mergebrief.js (compile-time `types` aside,
// i18n is the one workspace runtime dep).
// The shebang lives in src/bin.ts and survives the bundle.
import { readFileSync } from "node:fs";
import { defineConfig } from "tsup";

const pkg: { version: string } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

export default defineConfig({
  entry: { mergebrief: "src/bin.ts" },
  // One version number: whatever package.json says at build time, the tag at
  // publish and 0.0.0 in the repo.
  define: { __CLI_VERSION__: JSON.stringify(pkg.version) },
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
