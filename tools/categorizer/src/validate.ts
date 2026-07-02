import type { RevisionChangeFile } from "./revchanges.js";
import type { ChangeGroup, Chunk, LineRange, RevisionNarrativeChunk } from "./types.js";

/**
 * Validate the chunk↔group partition. With group membership on the chunk
 * (`changeGroupId`), duplicate and orphan chunks are structurally impossible
 * (a chunk has exactly one required group id). What remains to check is a
 * dangling reference (a chunk pointing at a group that doesn't exist) and a
 * group with no chunks / no carrier. Returns human-readable issues — empty
 * means clean.
 */
export function validatePartition(
  groups: Pick<ChangeGroup, "id">[],
  chunks: Pick<Chunk, "id" | "changeGroupId" | "role">[],
): string[] {
  const issues: string[] = [];
  const groupIds = new Set(groups.map((g) => g.id));

  for (const c of chunks) {
    if (!groupIds.has(c.changeGroupId)) {
      issues.push(`chunk ${c.id} references unknown group "${c.changeGroupId}"`);
    }
  }

  for (const g of groups) {
    const members = chunks.filter((c) => c.changeGroupId === g.id);
    if (members.length === 0) {
      issues.push(`group ${g.id} has no chunks`);
    } else if (!members.some((c) => c.role === "carrier")) {
      issues.push(`group ${g.id} has no carrier chunk`);
    }
  }

  return issues;
}

/**
 * Validate a Revision narrative's `briefChangeGroupId` references against the
 * current full Brief's actual change-groups (ADR 0024). Unlike
 * `validatePartition`, group membership here is NOT structurally guaranteed —
 * the narrative and the Brief are two independent model outputs — so a
 * dangling reference is a real possibility the model can produce. Warn, never
 * hard-fail: schema validity is the only hard-fail condition for a narrative.
 */
export function validateNarrativeGroups(
  chunks: Pick<RevisionNarrativeChunk, "id" | "briefChangeGroupId">[],
  changeGroups: Pick<ChangeGroup, "id">[],
): string[] {
  const groupIds = new Set(changeGroups.map((g) => g.id));
  const issues: string[] = [];
  for (const c of chunks) {
    if (!groupIds.has(c.briefChangeGroupId)) {
      issues.push(
        `narrative chunk ${c.id} references unknown brief change-group "${c.briefChangeGroupId}"`,
      );
    }
  }
  return issues;
}

function rangesOverlap(a: LineRange, b: LineRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

function anyOverlap(as: LineRange[], bs: LineRange[]): boolean {
  return as.some((a) => bs.some((b) => rangesOverlap(a, b)));
}

/**
 * Validate that each Revision-narrative chunk overlaps a mechanical
 * comparison mark for the same file (ADR 0024: "highlighting is mechanical;
 * generated narratives explain marks but never decide them" — coverage should
 * still line up). Compares added-side to added-side and removed-side to
 * removed-side, matching how the FE joins marks. Warn only. Typed against
 * `RevisionChangeFile` — structurally identical to a `ComparisonMarksFile`
 * (which aliases it), for either baseline label.
 */
export function validateNarrativeMarksOverlap(
  chunks: Pick<RevisionNarrativeChunk, "id" | "file" | "addedRanges" | "removedRanges">[],
  marksFiles: Pick<RevisionChangeFile, "file" | "addedRanges" | "removedRanges">[],
): string[] {
  const issues: string[] = [];
  for (const c of chunks) {
    const marksForFile = marksFiles.filter((m) => m.file === c.file);
    const overlaps =
      marksForFile.some((m) => anyOverlap(c.addedRanges, m.addedRanges)) ||
      marksForFile.some((m) => anyOverlap(c.removedRanges, m.removedRanges));
    if (!overlaps) {
      issues.push(
        `narrative chunk ${c.id} (${c.file}) does not overlap any mechanical comparison mark`,
      );
    }
  }
  return issues;
}
