import type { Mutable } from "types/utils";
import { planAnchoredGeneration, stitchBrief } from "../../anchoring";
import type { AnchorPlanArgs } from "../../anchoring/types";
import { parseChangedRanges } from "../../diff/revchanges";
import { categorizeWithWarnings, DEFAULT_EFFORT } from "../categorize";
import {
  GenerationWarningKinds,
  type GenerationWarning,
} from "../warnings/types";
import type {
  GenerateBriefOptions,
  GenerateBriefResult,
  PreviousBriefInput,
} from "./types";

const STITCH_CHECK = "anchored stitch";
/** Checks the stitch recomputes over the merged artifact. */
const STITCH_REPLACED_CHECKS: ReadonlySet<string> = new Set([
  "text length",
  "loc overlap",
]);

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

function isKeptByStitch(warning: GenerationWarning): boolean {
  if (warning.kind !== GenerationWarningKinds.VALIDATION) {
    return true;
  }
  return !STITCH_REPLACED_CHECKS.has(warning.check);
}

/**
 * Generate one Brief: fresh without `previous`, else plan the carry, generate
 * against the anchor view and stitch. A stitch coverage failure is the error.
 */
export async function generateBrief(
  options: GenerateBriefOptions,
): Promise<GenerateBriefResult> {
  const { pr, headIndex, commitRange, generator, previous } = options;
  const effort = options.effort ?? DEFAULT_EFFORT;
  const log = options.log ?? discardLog;

  if (previous === undefined) {
    const fresh = await categorizeWithWarnings(
      pr,
      headIndex,
      commitRange,
      generator,
      log,
      options.repoContext,
      effort,
      undefined,
    );
    return { ok: true, value: fresh };
  }

  const plan = planAnchoredGeneration(buildPlanArgs(previous));
  await previous.onPlan?.(plan);
  const anchorView = {
    previousBrief: previous.brief,
    frozenGroupIds: plan.frozen.map((carry) => carry.group.id),
  };
  const generated = await categorizeWithWarnings(
    pr,
    headIndex,
    commitRange,
    generator,
    log,
    options.repoContext,
    effort,
    anchorView,
  );

  const stitched = stitchBrief({
    generated: generated.brief,
    plan,
    prFiles: pr.meta.files.map((file) => file.path),
    changedFiles: parseChangedRanges(pr.diff),
  });
  if (!stitched.ok) {
    return stitched;
  }

  const { brief, issues, ...anchoring } = stitched.value;
  const warnings = generated.warnings.filter(isKeptByStitch);
  if (issues.length > 0) {
    warnings.push({
      kind: GenerationWarningKinds.VALIDATION,
      check: STITCH_CHECK,
      issues,
    });
  }

  return {
    ok: true,
    value: { brief, warnings, anchoring: { plan, ...anchoring } },
  };
}
