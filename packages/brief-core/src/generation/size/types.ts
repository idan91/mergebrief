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
  /** The diff's tokens alone: the prompt, description and context around it are not counted. */
  readonly estimatedInputTokens: number;
  readonly hunkCount: number;
  readonly forced: boolean;
}
