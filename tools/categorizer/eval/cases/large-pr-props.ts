import type { RevisionChangeFile } from "brief-core";
import type { Brief, LineRange } from "brief-core/types";
import type { EvalProperty } from "../properties";

/**
 * Mechanical property builders for the large third-party cases: pipeline
 * guarantees over a multi-call brief, never model judgment. Any failure is a
 * pipeline bug.
 */

type RangesByFile = Map<string, LineRange[]>;

function addRanges(
  rangesByFile: RangesByFile,
  file: string,
  ranges: readonly LineRange[],
): void {
  const fileRanges = rangesByFile.get(file) ?? [];
  fileRanges.push(...ranges);
  rangesByFile.set(file, fileRanges);
}

/** `ranges` sorted with touching ones joined, so two equal line sets read the same; by interval, so a huge range costs nothing. */
function mergeRanges(ranges: readonly LineRange[]): LineRange[] {
  const sorted = ranges.toSorted((left, right) => left.start - right.start);
  const merged: LineRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
      continue;
    }
    merged.push({ ...range });
  }
  return merged;
}

function holdsSameLines(
  left: readonly LineRange[],
  right: readonly LineRange[],
): boolean {
  const leftLines = mergeRanges(left);
  const rightLines = mergeRanges(right);
  return (
    leftLines.length === rightLines.length &&
    leftLines.every((range, index) => {
      const other = rightLines[index];
      return range.start === other?.start && range.end === other.end;
    })
  );
}

/** The lines both merged range lists hold. */
function intersectRanges(
  left: readonly LineRange[],
  right: readonly LineRange[],
): LineRange[] {
  const leftLines = mergeRanges(left);
  const rightLines = mergeRanges(right);
  const shared: LineRange[] = [];
  let index = 0;
  for (const range of leftLines) {
    while ((rightLines[index]?.end ?? Infinity) < range.start) {
      index += 1;
    }
    for (let next = index; next < rightLines.length; next += 1) {
      const other = rightLines[next];
      if (other === undefined || other.start > range.end) {
        break;
      }
      shared.push({
        start: Math.max(range.start, other.start),
        end: Math.min(range.end, other.end),
      });
    }
  }
  return shared;
}

interface SideClaims {
  claimed: RangesByFile;
  byChunks: RangesByFile;
  byRemainder: RangesByFile;
  changed: RangesByFile;
}

function makeSideClaims(): SideClaims {
  return {
    claimed: new Map(),
    byChunks: new Map(),
    byRemainder: new Map(),
    changed: new Map(),
  };
}

/**
 * On one side, file by file: every changed line is claimed, the remainder
 * holds changed lines only, and no changed line is both a remainder line and
 * a chunk's. A chunk range may spill past the change, as `loc` clamps it.
 */
function partitionsSide(side: SideClaims): boolean {
  const files = new Set([...side.claimed.keys(), ...side.changed.keys()]);
  return [...files].every((file) => {
    const changed = side.changed.get(file) ?? [];
    const remainder = side.byRemainder.get(file) ?? [];
    const claimedChanges = intersectRanges(
      side.claimed.get(file) ?? [],
      changed,
    );
    const remainderChanges = intersectRanges(remainder, changed);
    const chunkChanges = intersectRanges(
      side.byChunks.get(file) ?? [],
      changed,
    );
    const coversDiff = holdsSameLines(claimedChanges, changed);
    const remainderInDiff = holdsSameLines(remainderChanges, remainder);
    const doubled = intersectRanges(remainderChanges, chunkChanges).length > 0;
    return coversDiff && remainderInDiff && !doubled;
  });
}

/** Whether the chunks and the remainder partition the diff's changed lines on both sides. */
function claimsChangedLines(
  brief: Brief,
  changedFiles: readonly RevisionChangeFile[],
): boolean {
  const added = makeSideClaims();
  const removed = makeSideClaims();
  for (const chunk of brief.chunks) {
    addRanges(added.byChunks, chunk.file, chunk.addedRanges);
    addRanges(removed.byChunks, chunk.file, chunk.removedRanges);
  }
  for (const file of brief.unattributed ?? []) {
    addRanges(added.byRemainder, file.file, file.addedRanges);
    addRanges(removed.byRemainder, file.file, file.removedRanges);
  }
  for (const side of [added, removed]) {
    for (const ranges of [side.byChunks, side.byRemainder]) {
      for (const [file, fileRanges] of ranges) {
        addRanges(side.claimed, file, fileRanges);
      }
    }
  }
  for (const file of changedFiles) {
    addRanges(added.changed, file.file, file.addedRanges);
    addRanges(removed.changed, file.file, file.removedRanges);
  }
  return partitionsSide(added) && partitionsSide(removed);
}

/** The group partition and line coverage every large case must hold. */
export function buildPartitionProperties(): EvalProperty[] {
  return [
    {
      id: "group-ids-unique",
      description: "the brief has groups and no two share an id",
      check: (brief) => {
        const ids = brief.changeGroups.map((group) => group.id);
        return ids.length > 0 && new Set(ids).size === ids.length;
      },
    },
    {
      id: "no-empty-groups",
      description: "every change group owns at least one chunk",
      check: (brief) => {
        const owners = new Set(
          brief.chunks.map((chunk) => chunk.changeGroupId),
        );
        return brief.changeGroups.every((group) => owners.has(group.id));
      },
    },
    {
      id: "no-unknown-groups",
      description: "every chunk names a change group the brief carries",
      check: (brief) => {
        const ids = new Set(brief.changeGroups.map((group) => group.id));
        return brief.chunks.every((chunk) => ids.has(chunk.changeGroupId));
      },
    },
    {
      id: "every-line-attributed-or-remainder",
      description:
        "every changed line is in a chunk or the unattributed remainder, never both, and the remainder holds changed lines only",
      check: (brief, changedFiles) => {
        const readable =
          brief.diffTotals !== undefined && changedFiles !== undefined;
        return readable && claimsChangedLines(brief, changedFiles);
      },
    },
  ];
}

/** Each listed lockfile reads shortened: code-written `generated` chunks carrying `readAs`. */
export function buildLockfileShortening(
  lockfiles: readonly string[],
): EvalProperty {
  return {
    id: "lockfiles-read-shortened",
    description: `${lockfiles.join(", ")} read shortened as generated chunks`,
    check: (brief) =>
      lockfiles.every((path) => {
        const chunks = brief.chunks.filter((chunk) => chunk.file === path);
        return (
          chunks.length > 0 &&
          chunks.every(
            (chunk) =>
              chunk.concern === "generated" && chunk.readAs !== undefined,
          )
        );
      }),
  };
}
