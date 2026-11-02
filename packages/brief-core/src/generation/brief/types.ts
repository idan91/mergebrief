import type { Effort, Generator, Logger } from "generators";
import type { AnchorPlan } from "../../anchoring/types";
import type { PrSpan } from "../../diff/pr-span/types";
import type { FetchedPr } from "../../github/types";
import type { Brief, CommitRange, OutlineForm } from "../../types";
import type { MultiCallHooks } from "../multi-call/types";
import type { RepoContext } from "../repo-context";
import type { LockfileSummary } from "../shortened/types";
import type { CallPlanKind } from "../size/types";
import type { GenerationWarning } from "../warnings/types";

/** The brief a revision anchors on, plus what the plan reads about the push. */
export interface PreviousBriefInput {
  readonly brief: Brief;
  /** The PR's own change between the previous head and this one; absent re-looks every group. */
  readonly span?: PrSpan | undefined;
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
  /**
   * Each changed lockfile's package summary at the PR's base and head, keyed
   * by head path. A lockfile missing here sets `changes-package-source`.
   */
  readonly lockfileSummaries?: ReadonlyMap<string, LockfileSummary> | undefined;
  /** Plans the multi-call path whatever the diff's size; off by default. */
  readonly forceMultiCall?: boolean | undefined;
  /** The default branch's `.gitattributes`, read for generated and vendored files on a multi-call run. */
  readonly gitAttributes?: string | undefined;
  /** Skips the outline ladder on a multi-call run. */
  readonly forcedOutlineForm?: OutlineForm | undefined;
  /** Detail calls in flight at once after the first; 8 when absent. */
  readonly detailConcurrency?: number | undefined;
  /** Per-call efforts on a multi-call run; each falls back to `effort`. */
  readonly groupingEffort?: Effort | undefined;
  readonly detailEffort?: Effort | undefined;
  /**
   * Present only for a caller that can run a multi-call brief: it claims
   * the run's units and stores its parts through these, or passes `{}` when
   * it bills and stores nothing. Absent, the call plan is only logged and
   * the brief runs as one call.
   */
  readonly multiCallHooks?: MultiCallHooks | undefined;
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
  /**
   * The route the run took. `multi` re-looked every group and anchored on
   * nothing, whatever `previous` held: its group ids were minted past the
   * chain's and the caller must not stamp the brief anchored.
   */
  readonly ranAs: CallPlanKind;
  /** Present on an anchored run. */
  readonly anchoring?: BriefAnchoring;
}
