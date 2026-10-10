import type { DiffLine } from "@web/utils/diffTokens/types";
import { parseUnifiedDiffPatch } from "../utils/diff-slicing";

/**
 * A PR's per-file patches, parsed into rows on first read and kept for the
 * page's life. Chunk slicing and hunk-edge expansion both read a file's
 * rows, so one parse serves both.
 */
export interface FileRowsCache {
  isEmpty: boolean;
  getFileRows(path: string): DiffLine[] | undefined;
}

export function createFileRowsCache(
  patches: ReadonlyMap<string, string>,
): FileRowsCache {
  const parsed = new Map<string, DiffLine[]>();

  return {
    isEmpty: patches.size === 0,
    getFileRows(path) {
      const known = parsed.get(path);
      if (known !== undefined) {
        return known;
      }
      const patch = patches.get(path);
      if (patch === undefined) {
        return undefined;
      }

      const rows = parseUnifiedDiffPatch(patch);
      parsed.set(path, rows);
      return rows;
    },
  };
}
