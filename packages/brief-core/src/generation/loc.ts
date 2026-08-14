/**
 * Mechanical LoC derivation: the model attributes lines (chunk ranges), code
 * counts them. Chunk/group counts are intersections of validated ranges with
 * the diff's actual changed lines; whatever no chunk claims is the
 * unattributed remainder. Pure functions, no model calls.
 */
import { Concerns, type Chunk, type ConcernRollup, type LineRange } from "../types";
import type { RevisionChangeFile } from "../diff/revchanges";
import type { PrFile } from "../github/types";

export interface LocCount {
  added: number;
  deleted: number;
}

/** Changed lines no chunk claims, as per-file ranges (counts derive from them). */
export interface UnattributedFile {
  file: string;
  addedRanges: LineRange[];
  removedRanges: LineRange[];
}

/**
 * Sort + merge overlapping/adjacent ranges into a canonical disjoint list.
 * Inverted ranges (end < start) drop — the schema doesn't forbid them and the
 * ranges are model-produced, so they must not corrupt counts or subtraction.
 */
function normalize(ranges: LineRange[]): LineRange[] {
  const sorted = ranges
    .filter((r) => r.end >= r.start)
    .toSorted((a, b) => a.start - b.start);
  const merged: LineRange[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last !== undefined && range.start <= last.end + 1) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
}

/** Count distinct lines covered (overlaps collapse before counting). */
export function countLines(ranges: LineRange[]): number {
  return normalize(ranges).reduce((sum, r) => sum + (r.end - r.start + 1), 0);
}

/** Distinct lines present in both range lists, as canonical ranges. */
export function intersectRanges(
  a: LineRange[],
  b: LineRange[],
): LineRange[] {
  const as = normalize(a);
  const bs = normalize(b);
  const out: LineRange[] = [];
  let i = 0;
  let j = 0;
  while (i < as.length && j < bs.length) {
    const x = as[i];
    const y = bs[j];
    if (x === undefined || y === undefined) break;
    const start = Math.max(x.start, y.start);
    const end = Math.min(x.end, y.end);
    if (start <= end) out.push({ start, end });
    if (x.end < y.end) i++;
    else j++;
  }
  return out;
}

/** Distinct lines in `a` not covered by `b`, as canonical ranges. */
export function subtractRanges(a: LineRange[], b: LineRange[]): LineRange[] {
  const bs = normalize(b);
  const out: LineRange[] = [];
  for (const range of normalize(a)) {
    let start = range.start;
    for (const cut of bs) {
      if (cut.end < start) continue;
      if (cut.start > range.end) break;
      if (cut.start > start) out.push({ start, end: cut.start - 1 });
      start = cut.end + 1;
      if (start > range.end) break;
    }
    if (start <= range.end) out.push({ start, end: range.end });
  }
  return out;
}

type ChunkRanges = Pick<Chunk, "file" | "addedRanges" | "removedRanges">;

function indexChanged(
  files: RevisionChangeFile[],
): Map<string, { added: LineRange[]; removed: LineRange[] }> {
  return new Map(
    files.map((f) => [
      f.file,
      { added: normalize(f.addedRanges), removed: normalize(f.removedRanges) },
    ]),
  );
}

/**
 * Populate each chunk's `loc` as |chunk ranges ∩ the diff's changed lines| —
 * ranges spilling past the real change clamp to it, and a file absent from the
 * diff counts zero.
 */
export function deriveChunkLoc<C extends ChunkRanges>(
  chunks: C[],
  changedFiles: RevisionChangeFile[],
): (C & { loc: LocCount })[] {
  const byFile = indexChanged(changedFiles);
  return chunks.map((chunk) => {
    const changed = byFile.get(chunk.file);
    if (changed === undefined) {
      return { ...chunk, loc: { added: 0, deleted: 0 } };
    }
    return {
      ...chunk,
      loc: {
        added: countLines(intersectRanges(chunk.addedRanges, changed.added)),
        deleted: countLines(
          intersectRanges(chunk.removedRanges, changed.removed),
        ),
      },
    };
  });
}

/**
 * The per-file complement of the union of all chunk ranges within the diff's
 * changed lines. Files where every changed line is attributed drop out.
 */
export function deriveUnattributed(
  chunks: ChunkRanges[],
  changedFiles: RevisionChangeFile[],
): UnattributedFile[] {
  return changedFiles.flatMap((file) => {
    const claimed = chunks.filter((c) => c.file === file.file);
    const addedRanges = subtractRanges(
      file.addedRanges,
      claimed.flatMap((c) => c.addedRanges),
    );
    const removedRanges = subtractRanges(
      file.removedRanges,
      claimed.flatMap((c) => c.removedRanges),
    );
    if (addedRanges.length === 0 && removedRanges.length === 0) return [];
    return [{ file: file.file, addedRanges, removedRanges }];
  });
}

/** Total added/deleted lines an unattributed remainder holds. */
export function unattributedTotals(files: UnattributedFile[]): LocCount {
  return {
    added: files.reduce((sum, f) => sum + countLines(f.addedRanges), 0),
    deleted: files.reduce((sum, f) => sum + countLines(f.removedRanges), 0),
  };
}

/**
 * The mechanical concern rollup from chunks with derived loc — one entry per
 * concern present, in vocabulary order.
 */
export function buildConcernView(
  chunks: Pick<Chunk, "concern" | "loc">[],
): ConcernRollup[] {
  const totals = new Map<Chunk["concern"], LocCount>();
  for (const chunk of chunks) {
    const entry = totals.get(chunk.concern) ?? { added: 0, deleted: 0 };
    entry.added += chunk.loc.added;
    entry.deleted += chunk.loc.deleted;
    totals.set(chunk.concern, entry);
  }
  return Concerns.flatMap((concern) => {
    const loc = totals.get(concern);
    if (loc === undefined) return [];
    return [{ concern, added: loc.added, deleted: loc.deleted }];
  });
}

function overlapIssues(
  side: "added" | "removed",
  a: Pick<Chunk, "id" | "file">,
  b: Pick<Chunk, "id">,
  overlap: LineRange[],
): string[] {
  if (overlap.length === 0) return [];
  const lines = overlap
    .map((r) => (r.start === r.end ? `${r.start}` : `${r.start}-${r.end}`))
    .join(", ");
  return [
    `chunks ${a.id} and ${b.id} (${a.file}) both claim ${side} line(s) ${lines} — counted in both`,
  ];
}

/**
 * Same-file, same-side line ranges claimed by more than one chunk. Report
 * only — overlapping lines stay counted in both chunks by design.
 */
export function detectChunkOverlaps(
  chunks: Pick<Chunk, "id" | "file" | "addedRanges" | "removedRanges">[],
): string[] {
  const issues: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    for (let j = i + 1; j < chunks.length; j++) {
      const a = chunks[i];
      const b = chunks[j];
      if (a === undefined || b === undefined || a.file !== b.file) continue;
      issues.push(
        ...overlapIssues(
          "added",
          a,
          b,
          intersectRanges(a.addedRanges, b.addedRanges),
        ),
        ...overlapIssues(
          "removed",
          a,
          b,
          intersectRanges(a.removedRanges, b.removedRanges),
        ),
      );
    }
  }
  return issues;
}

/**
 * Per-file diff-derived totals vs gh's reported `additions`/`deletions`.
 * Warn-only, no threshold: any mismatch (including a file only one side
 * knows) is reported. Zero-count gh files absent from the diff are silent —
 * nothing to reconcile.
 */
export function crossCheckFileTotals(
  changedFiles: RevisionChangeFile[],
  prFiles: Pick<PrFile, "path" | "additions" | "deletions">[],
): string[] {
  const issues: string[] = [];
  const derivedByFile = new Map(
    changedFiles.map((f) => [
      f.file,
      { added: countLines(f.addedRanges), deleted: countLines(f.removedRanges) },
    ]),
  );
  const reportedPaths = new Set(prFiles.map((f) => f.path));
  for (const pr of prFiles) {
    const derived = derivedByFile.get(pr.path) ?? { added: 0, deleted: 0 };
    if (derived.added === pr.additions && derived.deleted === pr.deletions) {
      continue;
    }
    issues.push(
      `${pr.path}: diff-derived +${derived.added} -${derived.deleted} != gh-reported +${pr.additions} -${pr.deletions}`,
    );
  }
  for (const [file, derived] of derivedByFile) {
    if (reportedPaths.has(file)) continue;
    issues.push(
      `${file}: diff-derived +${derived.added} -${derived.deleted} but gh reports no such file`,
    );
  }
  return issues;
}

/** Whole-diff added/deleted totals — the header/core numbers. */
export function diffLocTotals(changedFiles: RevisionChangeFile[]): LocCount {
  return {
    added: changedFiles.reduce((sum, f) => sum + countLines(f.addedRanges), 0),
    deleted: changedFiles.reduce(
      (sum, f) => sum + countLines(f.removedRanges),
      0,
    ),
  };
}
