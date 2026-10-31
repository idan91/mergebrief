import type { HunkId } from "../../diff/hunk-index/types";
import type { LineRange } from "../../types";
import { subtractRanges } from "../loc";
import type { WarningCollector } from "../warnings/types";
import type { HunkLocation } from "./types";

const CUT_HUNK_CHECK = "cut hunk";

interface ChunkClaim {
  readonly file: string;
  readonly addedRanges: LineRange[];
  readonly removedRanges: LineRange[];
}

interface UnshownLines {
  added: LineRange[];
  removed: LineRange[];
}

/** Each file's lines a cut hunk never showed a detail call, by path. */
function listUnshownLines(
  locations: ReadonlyMap<HunkId, HunkLocation>,
): Map<string, UnshownLines> {
  const unshown = new Map<string, UnshownLines>();
  for (const location of locations.values()) {
    if (location.omittedRanges === undefined) {
      continue;
    }
    const lines = unshown.get(location.file.path) ?? { added: [], removed: [] };
    lines.added.push(...location.omittedRanges.addedRanges);
    lines.removed.push(...location.omittedRanges.removedRanges);
    unshown.set(location.file.path, lines);
  }
  return unshown;
}

/**
 * Every chunk with the lines no detail call was shown taken out, so they
 * fall to the unattributed remainder. A chunk that claimed lines and is
 * left with none drops: its text describes code its call never read.
 */
export function clampToShownLines<Claim extends ChunkClaim>(
  chunks: readonly Claim[],
  locations: ReadonlyMap<HunkId, HunkLocation>,
  warnings: WarningCollector,
): Claim[] {
  const unshown = listUnshownLines(locations);
  const issues: string[] = [];
  const kept = chunks.flatMap((chunk) => {
    const lines = unshown.get(chunk.file);
    if (lines === undefined) {
      return [chunk];
    }
    const addedRanges = subtractRanges(chunk.addedRanges, lines.added);
    const removedRanges = subtractRanges(chunk.removedRanges, lines.removed);
    const claimedLines =
      chunk.addedRanges.length > 0 || chunk.removedRanges.length > 0;
    const claimsNone = addedRanges.length === 0 && removedRanges.length === 0;
    if (claimedLines && claimsNone) {
      issues.push(
        `a chunk on ${chunk.file} claimed only lines its cut hunk never showed; dropped`,
      );
      return [];
    }
    return [{ ...chunk, addedRanges, removedRanges }];
  });
  warnings.reportIssues(CUT_HUNK_CHECK, issues);
  return kept;
}
