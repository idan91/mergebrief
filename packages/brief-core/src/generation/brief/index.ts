import type { Effort, Logger } from "generators";
import type { Mutable } from "types/utils";
import {
  planAnchoredGeneration,
  reserveIds,
  stitchBrief,
} from "../../anchoring";
import type { AnchorPlanArgs } from "../../anchoring/types";
import type { MediaItem } from "../../media";
import type { Brief } from "../../types";
import {
  DEFAULT_EFFORT,
  generateDraftBrief,
  type DraftBriefOptions,
} from "../categorize";
import { validateFinalBrief } from "../final-validation";
import {
  generateMultiCallBrief,
  hasStoredGrouping,
  isOutputCut,
} from "../multi-call";
import { decideCallPlan } from "../size";
import { pickSummaryMedia, readDescriptionMedia } from "../summary-media";
import { CallPlanKinds, type CallPlan, type CallPlanKind } from "../size/types";
import { createWarningCollector, formatGenerationWarnings } from "../warnings";
import {
  GenerationWarningKinds,
  type GenerationWarning,
  type WarningCollector,
} from "../warnings/types";
import type { LockfileSummary } from "../shortened/types";
import type {
  BriefAnchoring,
  GenerateBriefOptions,
  GenerateBriefOutput,
  PreviousBriefInput,
} from "./types";

const STITCH_CHECK = "anchored stitch";
const NO_HOOKS_NOTE =
  "call plan: running as one call, since the caller passed no multi-call hooks";

function discardLog(): void {}

function buildPlanArgs(previous: PreviousBriefInput): AnchorPlanArgs {
  const args: Mutable<AnchorPlanArgs> = {
    previousBrief: previous.brief,
    span: previous.span,
  };

  if (previous.chainGroupIds !== undefined) {
    args.chainGroupIds = previous.chainGroupIds;
  }

  return args;
}

function describeCallPlan(plan: CallPlan): string {
  return `call plan: ${plan.kind} (estimated diff ${plan.estimatedDiffTokens} tokens, ${plan.hunkCount} hunks)`;
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

interface BriefRun {
  readonly options: GenerateBriefOptions;
  readonly effort: Effort;
  readonly lockfileSummaries: ReadonlyMap<string, LockfileSummary>;
  readonly log: Logger;
  readonly warnings: WarningCollector;
  /** The description's Media, read once: the brief prompts note them, the Summary Media call picks from them. */
  readonly media: readonly MediaItem[];
}

/** The finished brief with its Summary Media, picked in a call of its own when the description holds Media. */
async function addSummaryMedia(brief: Brief, run: BriefRun): Promise<Brief> {
  if (run.media.length === 0) {
    return brief;
  }
  const summaryMedia = await pickSummaryMedia({
    generator: run.options.generator,
    pr: run.options.pr,
    media: run.media,
    summary: brief.summary,
    effort: run.effort,
    log: run.log,
    warnings: run.warnings,
  });
  if (summaryMedia === undefined) {
    return brief;
  }
  return { ...brief, summaryMedia };
}

function buildBriefOutput(
  brief: Brief,
  warnings: WarningCollector,
  ranAs: CallPlanKind,
  anchoring?: BriefAnchoring,
): GenerateBriefOutput {
  const listed = warnings.listWarnings();
  const output: Mutable<GenerateBriefOutput> = {
    brief: stampWarnings(brief, listed),
    warnings: listed,
    ranAs,
  };
  if (anchoring !== undefined) {
    output.anchoring = anchoring;
  }
  return output;
}

/**
 * A multi-call run re-looks every group: no anchor plan, no stitch. With a
 * previous brief its group ids are minted past every id the chain has used,
 * so none lands on a retired group.
 */
async function runMultiCall(run: BriefRun): Promise<GenerateBriefOutput> {
  const { options, effort, lockfileSummaries, log, warnings } = run;
  const { previous } = options;
  const reservedGroupIds =
    previous === undefined
      ? []
      : reserveIds(previous.brief, previous.chainGroupIds ?? []);
  const draft = await generateMultiCallBrief({
    pr: options.pr,
    headIndex: options.headIndex,
    commitRange: options.commitRange,
    generator: options.generator,
    groupingEffort: options.groupingEffort ?? effort,
    detailEffort: options.detailEffort ?? effort,
    repoContext: options.repoContext,
    lockfileSummaries,
    gitAttributes: options.gitAttributes,
    forcedOutlineForm: options.forcedOutlineForm,
    detailConcurrency: options.detailConcurrency,
    reservedGroupIds,
    hooks: options.multiCallHooks,
    holdsMedia: run.media.length > 0,
    log,
    warnings,
  });
  const validated = validateFinalBrief({
    ...draft,
    carriedChunkIds: [],
    acceptsRevisionDroppedChecks: false,
    warnings,
    lockfileSummaries,
  });
  const brief = await addSummaryMedia(validated, run);
  return buildBriefOutput(brief, warnings, CallPlanKinds.MULTI);
}

/** Fresh without `previous`, else plan the carry, generate against the anchor view and stitch. */
async function runSingleCall(run: BriefRun): Promise<GenerateBriefOutput> {
  const { options, effort, lockfileSummaries, log, warnings } = run;
  const { pr, previous } = options;
  const draftOptions: DraftBriefOptions = {
    pr,
    headIndex: options.headIndex,
    commitRange: options.commitRange,
    generator: options.generator,
    log,
    repoContext: options.repoContext,
    effort,
    anchor: undefined,
    holdsMedia: run.media.length > 0,
    warnings,
  };

  if (previous === undefined) {
    const draft = await generateDraftBrief(draftOptions);
    const validated = validateFinalBrief({
      ...draft,
      carriedChunkIds: [],
      acceptsRevisionDroppedChecks: false,
      warnings,
      lockfileSummaries,
    });
    const brief = await addSummaryMedia(validated, run);
    return buildBriefOutput(brief, warnings, CallPlanKinds.SINGLE);
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
  const validated = validateFinalBrief({
    brief: stitched,
    context: draft.context,
    carriedChunkIds: anchoring.carriedChunkIds,
    acceptsRevisionDroppedChecks: true,
    warnings,
    lockfileSummaries,
  });
  const brief = await addSummaryMedia(validated, run);
  return buildBriefOutput(brief, warnings, CallPlanKinds.SINGLE, {
    plan,
    ...anchoring,
  });
}

/**
 * Generate one Brief: a multi-call run when the call plan says so and the
 * caller passed `multiCallHooks`, else one call; with hooks, a single call
 * whose answer is cut at the output cap re-runs once as a multi-call run,
 * which starts its own warning list so the cut call's warnings are not
 * counted twice, and a retry whose span holds that run's grouping part
 * resumes it without sending the single call again. Validation runs once, over the final chunk set; nothing
 * after the model call fails the generation.
 */
export async function generateBrief(
  options: GenerateBriefOptions,
): Promise<GenerateBriefOutput> {
  const log = options.log ?? discardLog;
  const warnings = createWarningCollector(log);
  const callPlan = decideCallPlan({
    diff: options.pr.diff,
    forceMultiCall: options.forceMultiCall,
  });
  log(describeCallPlan(callPlan));
  const run: BriefRun = {
    options,
    effort: options.effort ?? DEFAULT_EFFORT,
    lockfileSummaries: options.lockfileSummaries ?? new Map(),
    log,
    warnings,
    media: readDescriptionMedia(options.pr),
  };

  const hooks = options.multiCallHooks;
  const plansMultiCall = callPlan.kind === CallPlanKinds.MULTI;
  if (hooks === undefined) {
    if (plansMultiCall) {
      log(NO_HOOKS_NOTE);
    }
    return runSingleCall(run);
  }
  if (plansMultiCall) {
    return runMultiCall(run);
  }

  if (await hasStoredGrouping(hooks, log)) {
    warnings.report({
      kind: GenerationWarningKinds.SINGLE_CALL_CUT,
      message:
        "an earlier attempt's single call reached the output cap; this attempt resumed its multi-call run from the stored parts",
    });
    return runMultiCall(run);
  }
  try {
    return await runSingleCall(run);
  } catch (error) {
    if (!isOutputCut(error)) {
      throw error;
    }
    const retryWarnings = createWarningCollector(log);
    retryWarnings.report({
      kind: GenerationWarningKinds.SINGLE_CALL_CUT,
      message:
        "the single call's answer reached the output cap; the brief was generated as a multi-call run instead",
    });
    return runMultiCall({ ...run, warnings: retryWarnings });
  }
}
