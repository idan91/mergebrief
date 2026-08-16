// The generator's core: write mode may short-circuit on a manifest newer than
// every source, `--check` always composes because it is the enforcement path.
// Exit codes live at the bin boundary.
import { readFile, writeFile } from "node:fs/promises";
import type { Result, ValueOf } from "types";
import {
  EmptyCatalogError,
  renderManifest,
} from "../src/product-operations/manifest";
import type { ProductOperationDescriptor } from "../src/product-operations/types";
import {
  decideManifestFreshness,
  fileMtimeMs,
  MANIFEST_FRESHNESS,
  newestMtimeMs,
} from "./manifest-freshness";

export const MANIFEST_MODE = {
  WRITE: "write",
  CHECK: "check",
} as const;
export type ManifestMode = ValueOf<typeof MANIFEST_MODE>;

export const MANIFEST_OUTCOME = {
  SKIPPED_CURRENT: "skipped-current",
  REGENERATED: "regenerated",
  VERIFIED: "verified",
} as const;
export type ManifestOutcome = ValueOf<typeof MANIFEST_OUTCOME>;

export const MANIFEST_FAILURE = {
  EMPTY_CATALOG: "empty-catalog",
  DRIFT: "drift",
} as const;
export type ManifestFailure = ValueOf<typeof MANIFEST_FAILURE>;

export interface RunManifestOptions {
  readonly mode: ManifestMode;
  readonly manifestPath: string;
  /** Files/directories whose mtimes gate the write path's short-circuit. */
  readonly sourceRoots: readonly string[];
  /** Composing the app IS registering — the caller owns that cost. */
  readonly collectOperations: () => Promise<
    readonly ProductOperationDescriptor[]
  >;
}

export async function runManifest(
  options: RunManifestOptions,
): Promise<Result<ManifestOutcome, ManifestFailure>> {
  if (options.mode === MANIFEST_MODE.WRITE && (await isCurrent(options))) {
    return { ok: true, value: MANIFEST_OUTCOME.SKIPPED_CURRENT };
  }

  const operations = await options.collectOperations();
  let rendered: string;
  try {
    rendered = renderManifest(operations);
  } catch (cause) {
    if (!(cause instanceof EmptyCatalogError)) {
      throw cause;
    }
    // An empty registry means composition never ran; writing it would pin an
    // empty catalog the drift check then passes against forever.
    return { ok: false, error: MANIFEST_FAILURE.EMPTY_CATALOG };
  }

  if (options.mode === MANIFEST_MODE.CHECK) {
    const committed = await readOrUndefined(options.manifestPath);
    if (committed !== rendered) {
      return { ok: false, error: MANIFEST_FAILURE.DRIFT };
    }
    return { ok: true, value: MANIFEST_OUTCOME.VERIFIED };
  }

  await writeFile(options.manifestPath, rendered);
  return { ok: true, value: MANIFEST_OUTCOME.REGENERATED };
}

async function isCurrent(options: RunManifestOptions): Promise<boolean> {
  const [manifestMtimeMs, newestSourceMtimeMs] = await Promise.all([
    fileMtimeMs(options.manifestPath),
    newestMtimeMs(options.sourceRoots),
  ]);
  return (
    decideManifestFreshness({ manifestMtimeMs, newestSourceMtimeMs }) ===
    MANIFEST_FRESHNESS.FRESH
  );
}

async function readOrUndefined(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}
