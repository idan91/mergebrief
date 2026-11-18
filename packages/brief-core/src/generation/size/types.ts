import type { ValueOf } from "types/utils";

export const CallPlanKinds = {
  SINGLE: "single",
  MULTI: "multi",
} as const;

export type CallPlanKind = ValueOf<typeof CallPlanKinds>;

export interface CallPlanInput {
  readonly diff: string;
  readonly forceMultiCall?: boolean | undefined;
}

/** How a Brief's generation would be split, and the measures that decided it. */
export interface CallPlan {
  readonly kind: CallPlanKind;
  readonly estimatedDiffTokens: number;
  readonly hunkCount: number;
  readonly forced: boolean;
}

/** What GitHub's pull request read says about a diff before it is fetched. */
export interface PullRequestCounts {
  readonly changedFiles: number;
  readonly additions: number;
  readonly deletions: number;
}
