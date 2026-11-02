import type {
  BuiltSpanPlan,
  FastForwardSpanInput,
  LineDiffInput,
  PrDiffPair,
  PrSpan,
  PrSpanInput,
  PrSpanRunner,
} from "brief-core/pr-span";
import type { Logger } from "logging";
import type { ValueOf } from "types/utils";

/** The span runner's steps, one per `PrSpanRunner` member. */
export const SpanStepKinds = {
  LINE_DIFF: "line-diff",
  PLAN_BUILT_SPAN: "plan-built-span",
  BUILD_PR_SPAN: "build-pr-span",
  BUILD_FAST_FORWARD_SPAN: "build-fast-forward-span",
} as const;
/** @public */
export type SpanStepKind = ValueOf<typeof SpanStepKinds>;

export const SpanStepAnswerKinds = {
  PATCH: "patch",
  /** A bound sent the file to its fallback. */
  NO_PATCH: "no-patch",
  PLAN: "plan",
  SPAN: "span",
} as const;
/** @public */
export type SpanStepAnswerKind = ValueOf<typeof SpanStepAnswerKinds>;

export type SpanStep =
  | {
      readonly kind: typeof SpanStepKinds.LINE_DIFF;
      readonly input: LineDiffInput;
    }
  | {
      readonly kind: typeof SpanStepKinds.PLAN_BUILT_SPAN;
      readonly input: PrDiffPair;
    }
  | {
      readonly kind: typeof SpanStepKinds.BUILD_PR_SPAN;
      readonly input: PrSpanInput;
    }
  | {
      readonly kind: typeof SpanStepKinds.BUILD_FAST_FORWARD_SPAN;
      readonly input: FastForwardSpanInput;
    };

/** One step posted to the thread. */
export interface SpanStepRequest {
  readonly id: number;
  readonly step: SpanStep;
}

/** The thread's answer to the request carrying the same id. */
export type SpanStepAnswer =
  | {
      readonly id: number;
      readonly kind: typeof SpanStepAnswerKinds.PATCH;
      readonly patch: string;
    }
  | { readonly id: number; readonly kind: typeof SpanStepAnswerKinds.NO_PATCH }
  | {
      readonly id: number;
      readonly kind: typeof SpanStepAnswerKinds.PLAN;
      readonly plan: BuiltSpanPlan;
    }
  | {
      readonly id: number;
      readonly kind: typeof SpanStepAnswerKinds.SPAN;
      readonly span: PrSpan;
    };

/** The API process's one span thread, started on the first step. */
export interface SpanThread {
  readonly runner: PrSpanRunner;
  /** Stops the thread: pending steps reject, and the next step starts a new one. */
  terminate(): Promise<void>;
}

export interface SpanThreadOptions {
  /** The thread's module; tests point it at a stand-in. */
  readonly entry?: URL;
  /** How long one step may go unanswered before the thread is stopped as stuck. */
  readonly answerLimitMs?: number;
  /** The wait before a restart after the second stop in a row, doubling per further stop. */
  readonly respawnBackoffMs?: number;
  /** The process logger: one line per stop and per malformed answer, since no request owns the thread. */
  readonly log?: Logger;
}
