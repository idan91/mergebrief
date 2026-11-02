import {
  BetweenHeadsKinds,
  type BuiltSpanPlan,
  type PrSpan,
} from "brief-core/pr-span";
import { z } from "zod/v4";
import {
  SpanStepAnswerKinds,
  SpanStepKinds,
  type SpanStepAnswer,
  type SpanStepRequest,
} from "./types";

const MessageIdSchema = z.number().int().nonnegative();

const ModeChangeSchema = z.strictObject({
  prevMode: z.string(),
  newMode: z.string(),
});

const LineDiffInputSchema = z.strictObject({
  contents: z.strictObject({
    prevPath: z.string(),
    path: z.string(),
    prevContent: z.string().optional(),
    newContent: z.string().optional(),
    modeChange: ModeChangeSchema.optional(),
    prevMode: z.string().optional(),
    newMode: z.string().optional(),
  }),
  maxEditLength: z.number().int().nonnegative(),
});

const BetweenHeadsFileSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal(BetweenHeadsKinds.PATCH),
    patch: z.string(),
    texts: z
      .strictObject({
        prevContent: z.string().optional(),
        newContent: z.string().optional(),
      })
      .exactOptional(),
  }),
  z.strictObject({ kind: z.literal(BetweenHeadsKinds.UNREADABLE) }),
]);

/** Strict, so an input field this schema does not read fails the thread instead of vanishing from its step. */
export const SpanStepRequestSchema = z.strictObject({
  id: MessageIdSchema,
  step: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal(SpanStepKinds.LINE_DIFF),
      input: LineDiffInputSchema,
    }),
    z.strictObject({
      kind: z.literal(SpanStepKinds.PLAN_BUILT_SPAN),
      input: z.strictObject({ prevPrDiff: z.string(), newPrDiff: z.string() }),
    }),
    z.strictObject({
      kind: z.literal(SpanStepKinds.BUILD_PR_SPAN),
      input: z.strictObject({
        prevPrDiff: z.string(),
        newPrDiff: z.string(),
        betweenHeads: z.map(z.string(), BetweenHeadsFileSchema),
        baseRenames: z.set(z.string()).exactOptional(),
      }),
    }),
    z.strictObject({
      kind: z.literal(SpanStepKinds.BUILD_FAST_FORWARD_SPAN),
      input: z.strictObject({
        betweenHeadsDiff: z.string(),
        newPrDiff: z.string(),
      }),
    }),
  ]),
}) satisfies z.ZodType<SpanStepRequest>;

const HeadModeSchema = z.strictObject({ mode: z.string().optional() });

const LineDiffFileSchema = z.strictObject({
  path: z.string(),
  prevPath: z.string(),
  modeChange: ModeChangeSchema.optional(),
  prev: HeadModeSchema.exactOptional(),
  next: HeadModeSchema.exactOptional(),
});

const BuiltSpanPlanSchema = z.strictObject({
  changedCount: z.number().int().nonnegative(),
  lineDiffFiles: z.array(LineDiffFileSchema),
  baseRenameCandidates: z.array(
    z.strictObject({
      path: z.string(),
      prevPath: z.string(),
      refusedLineDiffFiles: z.array(LineDiffFileSchema),
    }),
  ),
}) satisfies z.ZodType<BuiltSpanPlan>;

const LineNumberSchema = z.number().int().nonnegative();

const HopSchema = z.array(
  z.strictObject({
    file: z.string(),
    hunks: z.array(
      z.strictObject({
        oldStart: LineNumberSchema,
        oldLines: LineNumberSchema,
        newStart: LineNumberSchema,
        newLines: LineNumberSchema,
      }),
    ),
  }),
);

const PrSpanSchema = z.strictObject({
  changedFiles: z.array(z.string()),
  unchangedFiles: z.array(z.string()),
  unpairableFiles: z.array(z.string()),
  filteredDiff: z.string(),
  unfilteredDiff: z.string(),
  hop: HopSchema,
  oldSideHop: HopSchema,
  isUnchanged: z.boolean(),
}) satisfies z.ZodType<PrSpan>;

export const SpanStepAnswerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    id: MessageIdSchema,
    kind: z.literal(SpanStepAnswerKinds.PATCH),
    patch: z.string(),
  }),
  z.strictObject({
    id: MessageIdSchema,
    kind: z.literal(SpanStepAnswerKinds.NO_PATCH),
  }),
  z.strictObject({
    id: MessageIdSchema,
    kind: z.literal(SpanStepAnswerKinds.PLAN),
    plan: BuiltSpanPlanSchema,
  }),
  z.strictObject({
    id: MessageIdSchema,
    kind: z.literal(SpanStepAnswerKinds.SPAN),
    span: PrSpanSchema,
  }),
]) satisfies z.ZodType<SpanStepAnswer>;
