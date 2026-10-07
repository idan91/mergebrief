// brief-core owns `CompareFiles` so its producer and consumer share one shape.
import type { Hop } from "../diff/remap";
import type { Brief } from "../types";

export type ChangeGroup = Brief["changeGroups"][number];
export type Chunk = Brief["chunks"][number];

/**
 * One compare `files[]` entry. `status` stays an OPEN string on purpose: a new
 * GitHub status must degrade to conservative handling, not fail a parse.
 */
export interface CompareFile {
  readonly filename: string;
  readonly status: string;
  readonly previousFilename?: string;
}

export interface CompareFiles {
  readonly files: readonly CompareFile[];
  /**
   * False when the list may be truncated: GitHub caps a compare response at
   * 300 files, so a 300-entry list proves nothing about the rest.
   */
  readonly complete: boolean;
  /**
   * The compare relation head-vs-base ('ahead' | 'diverged' | 'behind' |
   * 'identical'; open string). Only 'ahead' means a fast-forward span whose
   * three-dot diff equals the true tree diff; a same-base force-push shows
   * 'diverged' while the base SHA never moves. Absent means not-fast-forward.
   */
  readonly status?: string;
}

export interface AnchorPlanArgs {
  readonly previousBrief: Brief;
  /** Undefined means the fetch failed and nothing is confirmable. */
  readonly incrementalDiff?: string;
  /** Undefined means the fetch failed and nothing is confirmable. */
  readonly compareFiles?: CompareFiles;
  /** Three-dot compare data lies after a base move, so everything re-looks. */
  readonly baseShaMoved: boolean;
  /** Reserved from descent so a retired id is never re-minted. */
  readonly chainGroupIds?: readonly string[];
}

export interface FrozenCarry {
  readonly group: ChangeGroup;
  readonly chunks: readonly Chunk[];
}

export interface ReLookEntry {
  readonly id: string;
  readonly files: readonly string[];
  readonly reason?: string;
}

export interface AnchorPlan {
  readonly frozen: readonly FrozenCarry[];
  readonly frozenFiles: ReadonlySet<string>;
  readonly reLook: readonly ReLookEntry[];
  readonly previousGroupIds: readonly string[];
  /**
   * Absent whenever the file list may be incomplete: a missing hop demotes an
   * anchor while a partial one misplaces it.
   */
  readonly hunkSpans?: Hop;
}

export interface StitchArgs {
  /** Model temp ids; may re-cover frozen files. */
  readonly generated: Brief;
  readonly plan: AnchorPlan;
  readonly prFiles: readonly string[];
}

export interface StitchResult {
  readonly brief: Brief;
  readonly carriedGroupIds: readonly string[];
  /** Chunk ids take a collision guard, not descent: marks carry on this set only. */
  readonly carriedChunkIds: readonly string[];
  readonly regeneratedGroupIds: readonly string[];
  /** The merge's own findings: departures, claims, numbering slips. */
  readonly issues: readonly string[];
}
