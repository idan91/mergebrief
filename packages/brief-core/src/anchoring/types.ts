import type { PrSpan } from "../diff/pr-span/types";
import type { Hop } from "../diff/remap";
import type { AnchorWarning, Brief } from "../types";

export type ChangeGroup = Brief["changeGroups"][number];
export type Chunk = Brief["chunks"][number];

export interface AnchorPlanArgs {
  readonly previousBrief: Brief;
  /** The PR's own change between the heads; absent when it could not be read, and every group re-looks. */
  readonly span?: PrSpan | undefined;
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
  /** Why the plan carried less than the push allowed; the stitched Brief stores them. */
  readonly warnings: readonly AnchorWarning[];
  /** The span's hop, every file of either head's PR diff; absent with no span, so the chain demotes. */
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
