import type { Effort, Generator, Logger } from "generators";
import type { AnchorPlan, CompareFiles } from "../../anchoring/types";
import type { FetchedPr } from "../../github";
import type { Brief, CommitRange } from "../../types";
import type { RepoContext } from "../repo-context";
import type { GenerationWarning } from "../warnings/types";

/** The brief a revision anchors on, plus what the plan reads about the push. */
export interface PreviousBriefInput {
  readonly brief: Brief;
  /** The prevHead to head span diff; absent re-looks every group. */
  readonly incrementalDiff?: string | undefined;
  /** The compare file list; absent re-looks every group. */
  readonly compareFiles?: CompareFiles | undefined;
  readonly baseShaMoved: boolean;
  /** Every group id the chain has used, reserved from descent. */
  readonly chainGroupIds?: readonly string[];
  /** Runs once the plan exists and before the model call; a throw ends the run. */
  readonly onPlan?: (plan: AnchorPlan) => Promise<void>;
}

export interface GenerateBriefOptions {
  readonly pr: FetchedPr;
  readonly headIndex: number;
  readonly commitRange: CommitRange;
  readonly generator: Generator;
  readonly effort?: Effort | undefined;
  readonly repoContext?: RepoContext | undefined;
  readonly log?: Logger;
  readonly previous?: PreviousBriefInput | undefined;
}

export interface BriefAnchoring {
  readonly plan: AnchorPlan;
  readonly carriedChunkIds: readonly string[];
  readonly carriedGroupIds: readonly string[];
  readonly regeneratedGroupIds: readonly string[];
}

export interface GenerateBriefOutput {
  readonly brief: Brief;
  readonly warnings: readonly GenerationWarning[];
  /** Present on an anchored run. */
  readonly anchoring?: BriefAnchoring;
}
