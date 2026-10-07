import type { ValueOf } from "types/utils";

import {
  Concerns,
  Roles,
  type BriefChunk,
  type LineRange,
  type UnattributedFile,
} from "../types";

export const GroupViewKinds = {
  ATTRIBUTED: "attributed",
  UNATTRIBUTED_REMAINDER: "unattributed-remainder",
} as const;
export type GroupViewKind = ValueOf<typeof GroupViewKinds>;

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

interface RemainderHydration {
  chunks: BriefChunk[];
  added: number;
  deleted: number;
}

export function getRemainderChunkId(
  file: string,
  usedIds: ReadonlySet<string>,
): string {
  const hex = hashFilePath(file);
  const natural = `u-${hex}`;
  if (!usedIds.has(natural)) {
    return natural;
  }

  let index = 1;
  let candidate = `${natural}-${String(index)}`;
  while (usedIds.has(candidate)) {
    index += 1;
    candidate = `${natural}-${String(index)}`;
  }
  return candidate;
}

export function isUnattributedRemainderChunk(chunk: BriefChunk): boolean {
  return chunk.changeGroupId === GroupViewKinds.UNATTRIBUTED_REMAINDER;
}

export function hydrateRemainderGroup(
  files: UnattributedFile[] | undefined,
  usedIds: ReadonlySet<string>,
): RemainderHydration | undefined {
  if (files === undefined) {
    return undefined;
  }

  const leftover = files.filter((file) => countLeftoverLines(file) > 0);
  if (leftover.length === 0) {
    return undefined;
  }

  const taken = new Set(usedIds);
  const chunks: BriefChunk[] = [];
  let added = 0;
  let deleted = 0;

  for (const file of leftover) {
    const fileAdded = sumRanges(file.addedRanges);
    const fileDeleted = sumRanges(file.removedRanges);
    const id = getRemainderChunkId(file.file, taken);
    taken.add(id);

    const chunk: BriefChunk = {
      id,
      changeGroupId: GroupViewKinds.UNATTRIBUTED_REMAINDER,
      file: file.file,
      concern: Concerns.IMPLEMENTATION,
      role: Roles.CORE,
      loc: { added: fileAdded, deleted: fileDeleted },
      addedRanges: file.addedRanges,
      removedRanges: file.removedRanges,
      riskSurface: [],
    };
    if (file.diff !== undefined) {
      chunk.diff = file.diff;
    }

    chunks.push(chunk);
    added += fileAdded;
    deleted += fileDeleted;
  }

  return { chunks, added, deleted };
}

function countLeftoverLines(file: UnattributedFile): number {
  return sumRanges(file.addedRanges) + sumRanges(file.removedRanges);
}

function sumRanges(ranges: LineRange[]): number {
  return ranges.reduce(
    (total, range) => total + (range.end - range.start + 1),
    0,
  );
}

function hashFilePath(file: string): string {
  let hash = FNV_OFFSET;
  const bytes = new TextEncoder().encode(file);
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, FNV_PRIME);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
