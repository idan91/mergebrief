// Single-file bundle: everything, commander, zod and the workspace packages
// (`i18n`, `contract`, `types`) included, bundles into dist/mergebrief.js.
// The shebang lives in src/bin.ts and survives the bundle.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defineConfig, type Options } from "tsup";

import { buildThirdPartyLicenses } from "./scripts/third-party-licenses";

type EsbuildPlugin = NonNullable<Options["esbuildPlugins"]>[number];

const pkg: { version: string } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
);

// The bundle inlines third-party code, so it ships their notices beside it.
const thirdPartyLicenses: EsbuildPlugin = {
  name: "third-party-licenses",
  setup(build) {
    build.initialOptions.metafile = true;
    const outDir = build.initialOptions.outdir;
    if (outDir === undefined) {
      throw new Error("third-party-licenses needs the build's outdir");
    }

    build.onEnd((result) => {
      const inputs = Object.keys(result.metafile?.inputs ?? {});
      const notices = buildThirdPartyLicenses(inputs);
      if (!notices.ok) {
        return { errors: notices.error.map((text) => ({ text })) };
      }

      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "THIRD_PARTY_LICENSES"), notices.value);
      return undefined;
    });
  },
};

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
  target: "node24",
  bundle: true,
  noExternal: [/.*/],
  outDir: "dist",
  esbuildPlugins: [thirdPartyLicenses],
  clean: true,
  minify: false,
});
