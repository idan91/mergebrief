// Regenerates `product-operations.manifest.json`, or with `--check` verifies
// it. Composing the real app against a throwaway PGlite harness is what
// registers the catalog, so it is the expensive half: the write path skips it
// while the committed file is newer than every source, `--check` never does.
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANIFEST_FAILURE,
  MANIFEST_MODE,
  MANIFEST_OUTCOME,
  runManifest,
  type ManifestFailure,
  type ManifestOutcome,
} from "./run-manifest";

const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));
const MANIFEST = join(PACKAGE_ROOT, "product-operations.manifest.json");

// Everything composition can reach inside this package: the source tree it
// walks, the harness and logger under `test/` that drive it, the generator
// itself, and the manifest of deps it composes over. Deliberately wider than
// the declaration sites — a false "stale" costs one compose, a false "fresh"
// would hide drift until the build's `--check`.
const SOURCE_ROOTS = [
  join(PACKAGE_ROOT, "src"),
  join(PACKAGE_ROOT, "test"),
  join(PACKAGE_ROOT, "scripts"),
  join(PACKAGE_ROOT, "package.json"),
];

const OUTCOME_LINE = {
  [MANIFEST_OUTCOME.SKIPPED_CURRENT]:
    "product-operations manifest is current (sources unchanged).",
  [MANIFEST_OUTCOME.REGENERATED]: "product-operations manifest regenerated.",
  [MANIFEST_OUTCOME.VERIFIED]: "product-operations manifest is current.",
} as const satisfies Record<ManifestOutcome, string>;

const FAILURE_LINE = {
  [MANIFEST_FAILURE.EMPTY_CATALOG]:
    "composition registered no product operations — the committed manifest was left untouched",
  [MANIFEST_FAILURE.DRIFT]:
    "product-operations.manifest.json is stale — run: pnpm -C packages/api manifest",
} as const satisfies Record<ManifestFailure, string>;

const mode = process.argv.includes("--check")
  ? MANIFEST_MODE.CHECK
  : MANIFEST_MODE.WRITE;

const result = await runManifest({
  mode,
  manifestPath: MANIFEST,
  sourceRoots: SOURCE_ROOTS,
  // Imported lazily: loading the app graph and the PGlite harness costs about
  // as much as composing them, and the skipped path must pay neither.
  collectOperations: async () => {
    const [{ composeCatalog }, { productOperationRegistry }] =
      await Promise.all([
        import("../test/compose-catalog"),
        import("../src/product-operations/registry"),
      ]);
    const { harness } = await composeCatalog();
    try {
      return productOperationRegistry.list();
    } finally {
      await harness.close();
    }
  },
});

if (!result.ok) {
  process.stderr.write(`${FAILURE_LINE[result.error]}\n`);
  process.exit(1);
}

process.stdout.write(`${OUTCOME_LINE[result.value]}\n`);
