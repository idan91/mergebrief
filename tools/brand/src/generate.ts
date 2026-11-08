// The generator's composition root: the tool folder is resolved from this
// file's location, and every asset is written relative to the repo root.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildBrandAssets } from "./assets";
import { loadBrandMasters } from "./master";

const toolRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(toolRoot, "../..");
const masters = loadBrandMasters(toolRoot);

if (!masters.ok) {
  process.stderr.write(`${masters.error}\n`);
  process.exit(1);
}

for (const asset of buildBrandAssets(masters.value)) {
  const destination = join(repoRoot, asset.target);

  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, asset.bytes);
  process.stdout.write(`wrote ${asset.target}\n`);
}
