// Freshness of the committed manifest against the sources that can change
// what composition renders. The decision is pure; the filesystem walk around
// it only collects mtimes.
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import type { ValueOf } from "types";

export const ManifestFreshnesses = {
  FRESH: "fresh",
  STALE: "stale",
} as const;
export type ManifestFreshness = ValueOf<typeof ManifestFreshnesses>;

export interface ManifestFreshnessInput {
  /** `undefined` when the manifest does not exist. */
  readonly manifestMtimeMs: number | undefined;
  /** `undefined` when the walk found no source at all. */
  readonly newestSourceMtimeMs: number | undefined;
}

/**
 * Fresh only when the manifest is STRICTLY newer than every source. Equal
 * timestamps are stale: filesystem granularity can flatten an edit made in the
 * same tick as the last write, and a false "fresh" hides drift locally.
 */
export function decideManifestFreshness({
  manifestMtimeMs,
  newestSourceMtimeMs,
}: ManifestFreshnessInput): ManifestFreshness {
  if (manifestMtimeMs === undefined || newestSourceMtimeMs === undefined) {
    return ManifestFreshnesses.STALE;
  }
  if (manifestMtimeMs > newestSourceMtimeMs) {
    return ManifestFreshnesses.FRESH;
  }
  return ManifestFreshnesses.STALE;
}

const SKIPPED_DIRECTORIES = new Set(["node_modules", ".git"]);

/** Newest mtime under the given files/directories; `undefined` if none exist. */
export async function newestMtimeMs(
  paths: readonly string[],
): Promise<number | undefined> {
  return newest(await Promise.all(paths.map(newestUnder)));
}

/** An unreadable or absent file reads as "no timestamp", which is stale. */
export async function fileMtimeMs(path: string): Promise<number | undefined> {
  const info = await statOrUndefined(path);
  return info?.mtimeMs;
}

async function newestUnder(path: string): Promise<number | undefined> {
  const info = await statOrUndefined(path);
  if (info === undefined) {
    return undefined;
  }
  if (!info.isDirectory()) {
    return info.mtimeMs;
  }
  const entries = await readdir(path, { withFileTypes: true });
  const children = entries
    .filter(
      (entry) => !(entry.isDirectory() && SKIPPED_DIRECTORIES.has(entry.name)),
    )
    .map((entry) => newestUnder(join(path, entry.name)));
  // The directory's own mtime counts: a deletion or rename moves it while
  // leaving every surviving file's mtime untouched.
  return newest([info.mtimeMs, ...(await Promise.all(children))]);
}

async function statOrUndefined(path: string) {
  try {
    return await stat(path);
  } catch {
    return undefined;
  }
}

function newest(values: readonly (number | undefined)[]): number | undefined {
  let best: number | undefined;
  for (const value of values) {
    if (value !== undefined && (best === undefined || value > best)) {
      best = value;
    }
  }
  return best;
}
