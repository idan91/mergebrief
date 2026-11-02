import type { Effort, Generator, Logger } from "generators";
import type {
  FileId,
  HunkId,
  IndexedFile,
  IndexedHunk,
} from "../../diff/hunk-index/types";
import type { FetchedPr } from "../../github/types";
import type { AnchorPlan } from "../../anchoring/types";
import type {
  Brief,
  ChangeGroup,
  CommitRange,
  HunkMapEntry,
  IntentCheck,
  LineRange,
  OutlineForm,
  ReadingOrderStep,
} from "../../types";
import type { AcceptedRepoContext } from "../categorize";
import type { Outline } from "../outline/types";
import type { AnchorViewInput } from "../prompt";
import type { LockfileSummary } from "../shortened/types";
import type { RepoContext } from "../repo-context";
import type { WarningCollector } from "../warnings/types";

export interface GroupingRequestInput {
  readonly pr: FetchedPr;
  readonly outline: Outline;
  /** The files the outline covers: the PR's, or an anchored run's re-looked ones. */
  readonly fileCount: number;
  /** The hunks the outline marks; a shortened file's hunks are not among them. */
  readonly hunkCount: number;
  /** The run's one accepted repo-context view; the detail calls read the same one. */
  readonly accepted: AcceptedRepoContext;
  /** The description holds Media: the prompt keeps them out of the summary. */
  readonly holdsMedia: boolean;
  /** The Anchor of a run over a previous brief; absent on a fresh run, whose request stays as it was. */
  readonly anchor?: AnchorViewInput | undefined;
}

/** The grouping call's prompts, plus the ticket text the validation context verifies against. */
export interface GroupingRequest {
  readonly system: string;
  readonly user: string;
  /** The primary ticket as the prompt rendered it; "" without one. */
  readonly primaryText: string;
}

export interface HunkMapInput {
  readonly entries: readonly HunkMapEntry[];
  readonly files: readonly IndexedFile[];
  /** The files the outline showed as one line; each is assigned whole. */
  readonly shortenedFileIds: ReadonlySet<FileId>;
  /** Files of the diff the outline left out, an anchored run's frozen ones; a run of whole files steps over them. */
  readonly omittedFileIds?: ReadonlySet<FileId>;
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

/** What every detail call of a run shares: the PR text and the grouping call's output. */
export interface DetailPrefixInput {
  readonly pr: FetchedPr;
  readonly summary: string;
  /** Every group in reading order. */
  readonly groups: readonly ChangeGroup[];
  readonly hunksByGroup: ReadonlyMap<string, readonly HunkId[]>;
  /** The accepted repo context; its custom attributes bind the detail schema. */
  readonly repoContext: RepoContext | undefined;
  /** The rendered custom-attributes block, "" when none. */
  readonly attributesBlock: string;
}

/** One hunk with its file, both redacted once per run by `indexDetailHunks`. */
export interface ShownHunk {
  readonly file: IndexedFile;
  readonly hunk: IndexedHunk;
  /** The hunk's input tokens at the diff rate, its file's header lines included. */
  readonly estimatedTokens: number;
  /** Present on a hunk cut to the batch budget: the lines left off its tail. */
  readonly omittedLines?: number;
  /** Present with `omittedLines`: each side's line numbers the cut left off, which no chunk may claim. */
  readonly omittedRanges?: OmittedRanges;
}

/** The lines of a cut hunk no detail call was shown, in each side's coordinates. */
export interface OmittedRanges {
  readonly addedRanges: LineRange[];
  readonly removedRanges: LineRange[];
}

export interface DetailRequestInput {
  readonly batch: DetailBatch;
  readonly batchCount: number;
  readonly shownHunks: ReadonlyMap<HunkId, ShownHunk>;
  /** `buildDetailPrefix`'s text, the same for every batch. */
  readonly prefix: string;
  readonly repoContext: RepoContext | undefined;
  readonly attributesBlock: string;
}

export interface DetailRequest {
  readonly system: string;
  readonly userPrefix: string;
  readonly user: string;
}

/** The grouping output, a detail call's output, or a half of a cut batch's. */
export type PartKey =
  | "grouping"
  | `detail:${number}`
  | `detail:${number}:${1 | 2}`;

/** The detail calls a grouping planned, and those no stored part answers. */
export interface PlannedDetailCalls {
  readonly detailCalls: number;
  /** Each `detail:<n>` number the run pays a call for, by the engine's reuse rule. */
  readonly missingDetailCalls: readonly number[];
}

/**
 * Every stored part names groups by the stored grouping's ids, minted past
 * the chain of the run that stored it; this run's ids may differ.
 */
export interface StoredGroupIds {
  readonly toRun: ReadonlyMap<string, string>;
  readonly toStored: ReadonlyMap<string, string>;
}

/** What a caller hooks into a multi-call run; every hook is optional and awaited. */
export interface MultiCallHooks {
  /** After the grouping call, with the detail calls to come; a throw ends the run. */
  readonly onGroupingDone?: (plan: PlannedDetailCalls) => Promise<void>;
  /** Once, before the first detail call starts. */
  readonly onDetailStart?: () => Promise<void>;
  /** A stored part's body for the key, or undefined; a body its schema no longer accepts is regenerated. */
  readonly loadPart?: (key: PartKey) => Promise<unknown>;
  /** After each fresh call's output parsed, with the body to store; never for a reused part. */
  readonly onPartDone?: (key: PartKey, body: unknown) => Promise<void>;
}

export interface MultiCallOptions {
  readonly pr: FetchedPr;
  readonly headIndex: number;
  readonly commitRange: CommitRange;
  readonly generator: Generator;
  readonly groupingEffort: Effort;
  readonly detailEffort: Effort;
  readonly repoContext: RepoContext | undefined;
  readonly lockfileSummaries: ReadonlyMap<string, LockfileSummary>;
  /** The default branch's `.gitattributes`; absent reads every file in full. */
  readonly gitAttributes?: string | undefined;
  readonly forcedOutlineForm?: OutlineForm | undefined;
  /** A whole number of 1 or more; absent takes the default. */
  readonly detailConcurrency?: number | undefined;
  /**
   * A run over a previous brief: the grouping and detail calls cover the
   * files outside the plan's frozen groups only, and the stitch carries the
   * frozen groups afterwards.
   */
  readonly anchor?: MultiCallAnchor | undefined;
  readonly hooks?: MultiCallHooks | undefined;
  /** The description holds Media: the grouping prompt keeps them out of the summary. */
  readonly holdsMedia: boolean;
  readonly log: Logger;
  readonly warnings: WarningCollector;
}

/** The parts of a merged brief that name its groups by id. */
export interface GroupSections {
  changeGroups: ChangeGroup[];
  readingOrder?: ReadingOrderStep[] | undefined;
  intentCheck: IntentCheck;
}

export interface MultiCallAnchor {
  readonly previousBrief: Brief;
  readonly plan: AnchorPlan;
}
