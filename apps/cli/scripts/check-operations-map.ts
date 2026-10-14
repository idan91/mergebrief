// The lint-gate bin over `checkOperationsMap`: takes the operation ids from
// the contract's table and reads the CLI map, judges by exit code.
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProductOperations } from "contract";
import { cliCommandPaths } from "./command-paths";
import {
  checkOperationsMap,
  renderCatalogFingerprintModule,
  renderOperationCatalog,
} from "./operations-map-lib";

const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MAP = join(PKG_ROOT, "product-operations.map.json");
const FINGERPRINT_MODULE = join(
  PKG_ROOT,
  "src",
  "generated-catalog-fingerprint.ts",
);

const result = checkOperationsMap({
  operationIds: Object.keys(ProductOperations),
  mapRaw: readFileSync(MAP, "utf8"),
  today: new Date().toISOString().slice(0, 10),
  commandPaths: cliCommandPaths(),
});

if (!result.ok) {
  for (const error of result.error) {
    process.stderr.write(`${error}\n`);
  }
  process.stderr.write(
    "product-operations map check failed — fix apps/cli/product-operations.map.json\n",
  );
  process.exit(1);
}
const rendered = renderCatalogFingerprintModule(renderOperationCatalog());
if (process.argv.includes("--write")) {
  writeFileSync(FINGERPRINT_MODULE, rendered);
} else {
  let committed: string | undefined;
  try {
    committed = readFileSync(FINGERPRINT_MODULE, "utf8");
  } catch {
    committed = undefined;
  }
  if (committed !== rendered) {
    process.stderr.write(
      "baked catalog fingerprint is stale — run: pnpm -C apps/cli map:check --write\n",
    );
    process.exit(1);
  }
}

process.stdout.write(
  `product-operations map is exhaustive: ${result.value.commands} commands, ${result.value.gaps} gaps, ${result.value.webOnly} web-only.\n`,
);
