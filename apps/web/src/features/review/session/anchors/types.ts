import type { ReviewComment } from "../../utils/comments";
import type { ChunkRegion } from "../../utils/state";
import type { Disposition } from "../disposition";
import type { SessionDraftComment } from "../serverState";
import type { FlagAnchorWire } from "contract";

/** Chunk id to the region a flag anchor on that chunk states. */
export type ChunkRegions = ReadonlyMap<string, ChunkRegion>;

/** Brief-local flag id to the anchor its disposition row keys on. */
export type FlagAnchorWires = ReadonlyMap<string, FlagAnchorWire>;

export type DispositionsByFlag = Record<string, Disposition>;

export interface ResolvedDrafts {
  reviewComments: ReviewComment[];
  unplacedDrafts: SessionDraftComment[];
}

export interface CoveredRow {
  index: number;
  content: string;
}

export interface DraftRows {
  rowIds: string[];
  selectedText: string;
}
