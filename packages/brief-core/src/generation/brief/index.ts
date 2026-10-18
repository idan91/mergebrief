import type { Mutable } from "types/utils";
import { planAnchoredGeneration, stitchBrief } from "../../anchoring";
import type { AnchorPlanArgs } from "../../anchoring/types";
import type { Brief } from "../../types";
import {
  DEFAULT_EFFORT,
  generateDraftBrief,
  type DraftBriefOptions,
} from "../categorize";
import { validateFinalBrief } from "../final-validation";
import { createWarningCollector, formatGenerationWarnings } from "../warnings";
import type { GenerationWarning } from "../warnings/types";
import type {
  GenerateBriefOptions,
  GenerateBriefOutput,
  PreviousBriefInput,
} from "./types";

const STITCH_CHECK = "anchored stitch";

function discardLog(): void {}

function buildPlanArgs(previous: PreviousBriefInput): AnchorPlanArgs {
  const args: Mutable<AnchorPlanArgs> = {
    previousBrief: previous.brief,
    baseShaMoved: previous.baseShaMoved,
  };

  if (previous.incrementalDiff !== undefined) {
    args.incrementalDiff = previous.incrementalDiff;
  }
  if (previous.compareFiles !== undefined) {
    args.compareFiles = previous.compareFiles;
  }
  if (previous.chainGroupIds !== undefined) {
    args.chainGroupIds = previous.chainGroupIds;
  }

  return args;
}

function stampWarnings(
  brief: Brief,
  warnings: readonly GenerationWarning[],
): Brief {
  if (warnings.length === 0) {
    return brief;
  }
  return { ...brief, generationWarnings: formatGenerationWarnings(warnings) };
}

/**
 * Generate one Brief: fresh without `previous`, else plan the carry, generate
 * against the anchor view and stitch. Validation runs once, over the final
 * chunk set; nothing after the model call fails the generation.
 */
export async function generateBrief(
  options: GenerateBriefOptions,
): Promise<GenerateBriefOutput> {
  const { pr, previous } = options;
  const log = options.log ?? discardLog;
  const warnings = createWarningCollector(log);
  const draftOptions: DraftBriefOptions = {
    pr,
    headIndex: options.headIndex,
    commitRange: options.commitRange,
    generator: options.generator,
    log,
    repoContext: options.repoContext,
    effort: options.effort ?? DEFAULT_EFFORT,
    anchor: undefined,
    warnings,
  };

  if (previous === undefined) {
    const draft = await generateDraftBrief(draftOptions);
    const brief = validateFinalBrief({
      ...draft,
      carriedChunkIds: [],
      acceptsRevisionDroppedChecks: false,
      warnings,
    });
    const listed = warnings.listWarnings();
    return { brief: stampWarnings(brief, listed), warnings: listed };
  }

  const plan = planAnchoredGeneration(buildPlanArgs(previous));
  await previous.onPlan?.(plan);
  const draft = await generateDraftBrief({
    ...draftOptions,
    anchor: {
      previousBrief: previous.brief,
      frozenGroupIds: plan.frozen.map((carry) => carry.group.id),
    },
  });

  const {
    brief: stitched,
    issues,
    ...anchoring
  } = stitchBrief({
    generated: draft.brief,
    plan,
    prFiles: pr.meta.files.map((file) => file.path),
  });
  warnings.reportIssues(STITCH_CHECK, issues);
  const brief = validateFinalBrief({
    brief: stitched,
    context: draft.context,
    carriedChunkIds: anchoring.carriedChunkIds,
    acceptsRevisionDroppedChecks: true,
    warnings,
  });

  const listed = warnings.listWarnings();
  return {
    brief: stampWarnings(brief, listed),
    warnings: listed,
    anchoring: { plan, ...anchoring },
  };
}
