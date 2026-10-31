import type { Logger } from "generators";
import type { FileId, HunkId, IndexedFile } from "../../diff/hunk-index/types";
import type { FetchedPr } from "../../github/types";
import type { HunkMapEntry } from "../../types";
import type { Outline } from "../outline/types";
import type { RepoContext } from "../repo-context";
import type { WarningCollector } from "../warnings/types";

export interface GroupingRequestInput {
  readonly pr: FetchedPr;
  readonly outline: Outline;
  readonly hunkCount: number;
  readonly repoContext: RepoContext | undefined;
  readonly log: Logger;
  readonly warnings: WarningCollector;
}

/** The grouping call's prompts, plus what the request step accepted for the validation context. */
export interface GroupingRequest {
  readonly system: string;
  readonly user: string;
  /** The primary ticket as the prompt rendered it; "" without one. */
  readonly primaryText: string;
  /** The repo context the gates let through; its custom attributes bind the detail calls. */
  readonly repoContext: RepoContext | undefined;
}

export interface HunkMapInput {
  readonly entries: readonly HunkMapEntry[];
  readonly files: readonly IndexedFile[];
  /** The files the outline showed as one line; each is assigned whole. */
  readonly shortenedFileIds: ReadonlySet<FileId>;
  /** Every group id the grouping produced, reading order first; the earlier group keeps a hunk listed twice. */
  readonly groupIds: readonly string[];
  readonly warnings: WarningCollector;
}

/** Which group owns each hunk and each shortened file; what no group claimed is unlisted. */
export interface ResolvedHunkMap {
  readonly groupByShortenedFile: ReadonlyMap<FileId, string>;
  /** Each group's hunks in diff order; a group that owns none is absent. */
  readonly hunksByGroup: ReadonlyMap<string, readonly HunkId[]>;
  readonly unlistedHunkIds: readonly HunkId[];
  readonly unlistedFileIds: readonly FileId[];
}

/** One group's hunks inside a detail batch, in diff order. */
export interface BatchPart {
  readonly groupId: string;
  readonly hunkIds: readonly HunkId[];
}

/** One detail call's worth of hunks: whole groups in reading order, or one part of an oversized group. */
export interface DetailBatch {
  readonly index: number;
  readonly parts: readonly BatchPart[];
  readonly hunkCount: number;
  /** Present on a half of a batch whose answer was cut. */
  readonly half?: 1 | 2;
}

export interface DetailBatchPlanInput {
  /** Every group id in reading order, then the groups the order left out. */
  readonly groupIds: readonly string[];
  readonly hunksByGroup: ReadonlyMap<string, readonly HunkId[]>;
  /** Each hunk's estimated input tokens as a detail call renders it; a hunk absent here weighs nothing. */
  readonly hunkTokens: ReadonlyMap<HunkId, number>;
  /** Override the batch limits; tests only. */
  readonly maxHunks?: number;
  readonly maxTokens?: number;
}
