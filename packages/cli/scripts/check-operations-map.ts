// The lint-gate bin over `checkOperationsMap`: reads the committed api
// manifest and the CLI map, judges by exit code.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { cliCommandPaths } from "./command-paths";
import { checkOperationsMap } from "./operations-map-lib";

const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST = join(
  PKG_ROOT,
  "..",
  "api",
  "product-operations.manifest.json",
);
const MAP = join(PKG_ROOT, "product-operations.map.json");

const result = checkOperationsMap({
  manifestRaw: readFileSync(MANIFEST, "utf8"),
  mapRaw: readFileSync(MAP, "utf8"),
  today: new Date().toISOString().slice(0, 10),
  commandPaths: cliCommandPaths(),
});

if (!result.ok) {
  for (const error of result.error) {
    process.stderr.write(`${error}\n`);
  }
  process.stderr.write(
    "product-operations map check failed — fix packages/cli/product-operations.map.json\n",
  );
  process.exit(1);
}
process.stdout.write(
  `product-operations map is exhaustive: ${result.value.commands} commands, ${result.value.gaps} gaps, ${result.value.webOnly} web-only.\n`,
);
