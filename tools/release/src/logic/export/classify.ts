import type { Result } from "types/utils";

import { EXPORT_PATHS } from "./paths";
import type {
  Classification,
  ExcludedCount,
  ExportPaths,
  UnclassifiedPaths,
} from "./types";

const SEPARATOR = "/";

/** The top-level entry a tracked path sits under: `apps/` for a dir, the name for a root file. */
function readTopLevelEntry(path: string): string {
  const slash = path.indexOf(SEPARATOR);
  const entry = slash === -1 ? path : path.slice(0, slash + 1);
  return entry;
}

/**
 * Splits a commit's tracked paths by the manifest: an exclude prefix holds
 * a path back unconditionally, any other path ships when its top-level entry
 * is included, and a top-level entry in neither list fails the export.
 */
export function classifyTrackedPaths(
  paths: readonly string[],
  manifest: ExportPaths = EXPORT_PATHS,
): Result<Classification, UnclassifiedPaths> {
  const counts = new Map<string, number>(
    manifest.exclude.map((prefix) => [prefix, 0]),
  );
  const shipped: string[] = [];
  const unclassified = new Set<string>();

  for (const path of paths) {
    const prefix = manifest.exclude.find((excluded) =>
      path.startsWith(excluded),
    );
    if (prefix !== undefined) {
      counts.set(prefix, (counts.get(prefix) ?? 0) + 1);
      continue;
    }
    const entry = readTopLevelEntry(path);
    if (manifest.include.includes(entry)) {
      shipped.push(path);
    } else {
      unclassified.add(entry);
    }
  }

  if (unclassified.size > 0) {
    return { ok: false, error: { unclassified: [...unclassified].toSorted() } };
  }
  const excluded: ExcludedCount[] = [...counts].map(([prefix, count]) => ({
    prefix,
    count,
  }));
  return { ok: true, value: { shipped, excluded } };
}
