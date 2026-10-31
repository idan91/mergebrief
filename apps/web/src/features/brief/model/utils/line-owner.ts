import type { LineRange } from "brief-core/types";
import type { TFunction } from "i18next";
import { DiffLineKinds, DiffSides, type DiffSide } from "types";
import { type DiffLine } from "@web/utils/diffTokens/types";

import type { BriefChunk } from "../types";
import { GroupViewKinds, isUnattributedRemainderChunk } from "./remainder";
import { resolveGroupName } from "./resolve-group-name";
import type { BriefViewModel } from "./view-model";

/** One line of a file by side, where a jump lands inside a chunk. */
export interface LineTarget {
  side: DiffSide;
  line: number;
}

/** What a sibling span's header says about the chunk that owns its rows. */
export interface SpanOwner {
  chunkId: string;
  groupName: string;
  /** The group's 1-based place in reading order and how many groups there are. */
  groupIndex: number;
  groupCount: number;
  summary?: string;
  remainder: boolean;
}

/** One file's chunks and the owner label each resolves to. */
export interface FileLineOwners {
  chunks: readonly BriefChunk[];
  owners: ReadonlyMap<string, SpanOwner>;
}

interface MutableFileLineOwners {
  chunks: BriefChunk[];
  owners: Map<string, SpanOwner>;
}

function createFileLineOwners(): MutableFileLineOwners {
  return { chunks: [], owners: new Map() };
}

export function buildLineOwnersByFile(
  model: BriefViewModel,
  t: TFunction,
): ReadonlyMap<string, FileLineOwners> {
  const byFile = new Map<string, MutableFileLineOwners>();

  for (const group of model.groups) {
    const groupName = resolveGroupName(t, group);
    const remainder = group.kind === GroupViewKinds.UNATTRIBUTED_REMAINDER;

    for (const chunk of group.chunks) {
      const owner: SpanOwner = {
        chunkId: chunk.id,
        groupName,
        groupIndex: group.index + 1,
        groupCount: model.groups.length,
        remainder,
      };
      if (chunk.summary !== undefined) {
        owner.summary = chunk.summary;
      }

      const entry = byFile.get(chunk.file) ?? createFileLineOwners();
      entry.chunks.push(chunk);
      entry.owners.set(chunk.id, owner);
      byFile.set(chunk.file, entry);
    }
  }

  return byFile;
}

/** The owner of an expanded changed row: its old line for a deletion, its new line otherwise. */
export function resolveSpanOwner(
  index: FileLineOwners,
  line: DiffLine,
): SpanOwner | undefined {
  const side: DiffSide =
    line.kind === DiffLineKinds.DEL ? DiffSides.OLD : DiffSides.NEW;
  const number = side === DiffSides.OLD ? line.oldLine : line.newLine;
  if (number === undefined) {
    return undefined;
  }

  const chunk = resolveLineOwner(side, number, index.chunks);

  return chunk === undefined ? undefined : index.owners.get(chunk.id);
}

/**
 * The chunk of the file whose changed ranges hold the line: an attributed
 * chunk first, else the unattributed remainder. Generation warns on
 * overlapping ranges but ships them, so two attributed chunks can hold one
 * line; the narrowest range wins, which is the more specific claim.
 */
export function resolveLineOwner(
  side: DiffSide,
  line: number,
  chunks: readonly BriefChunk[],
): BriefChunk | undefined {
  let remainder: BriefChunk | undefined;
  let owner: BriefChunk | undefined;
  let ownerWidth = Number.POSITIVE_INFINITY;

  for (const chunk of chunks) {
    const ranges =
      side === DiffSides.NEW ? chunk.addedRanges : chunk.removedRanges;
    const width = resolveHoldingWidth(ranges, line);
    if (width === undefined) {
      continue;
    }
    if (isUnattributedRemainderChunk(chunk)) {
      remainder ??= chunk;
      continue;
    }

    if (width < ownerWidth) {
      owner = chunk;
      ownerWidth = width;
    }
  }

  return owner ?? remainder;
}

/** The line count of the narrowest range holding the line; undefined when none does. */
function resolveHoldingWidth(
  ranges: readonly LineRange[],
  line: number,
): number | undefined {
  let narrowest: number | undefined;
  for (const range of ranges) {
    if (line < range.start || line > range.end) {
      continue;
    }

    const width = range.end - range.start + 1;
    if (narrowest === undefined || width < narrowest) {
      narrowest = width;
    }
  }

  return narrowest;
}
