// The lint-gate bin over `checkOperationsMap`: takes the operation ids from
// the contract's table and reads the CLI map, judges by exit code.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ProductOperations } from "contract";
import { cliCommandPaths } from "./command-paths";
import { checkOperationsMap } from "./operations-map-lib";

const PKG_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MAP = join(PKG_ROOT, "product-operations.map.json");

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
process.stdout.write(
  `product-operations map is exhaustive: ${result.value.commands} commands, ${result.value.gaps} gaps, ${result.value.webOnly} web-only.\n`,
);
