import type { z } from "zod/v4";
import {
  categorizeDelta,
  categorizeRevisionNarrative,
  countChangedLines,
  exceedsDeltaCallLimits,
  exceedsNarrativeCallLimits,
  isHugeSpan,
  parseChangedRanges,
  type DeltaInput,
  type RevisionChangeFile,
  type RevisionNarrativeInput,
} from "brief-core";
import {
  DeltaBriefGenerationSchema,
  type Brief,
  type DeltaBrief,
  type ReviewComment,
  type RevisionNarrative,
} from "brief-core/types";
import type { Effort, GenerateRequest, Generator } from "generators";
import type { EvalFixture } from "./loadCase";

/** Brief indexes the pair's two heads take, the base first. */
export const BASE_BRIEF_INDEX = 1;
export const REVISED_BRIEF_INDEX = 2;

/** What a narrative property reads: the narrative, the Brief it aligned to, and the span's marks. */
export interface NarrativeRun {
  brief: Brief;
  narrative: RevisionNarrative;
  marksFiles: RevisionChangeFile[];
  filteredSpan: string;
}

/** What a delta property reads; `unknownGroupChunkIds` are chunks the pipeline dropped before `delta`. */
export interface DeltaRun {
  delta: DeltaBrief;
  filteredSpan: string;
  reviewComments: readonly ReviewComment[];
  unknownGroupChunkIds: readonly string[];
}

export interface NarrativeEvalProperty {
  id: string;
  description: string;
  check(run: NarrativeRun): boolean;
}

export interface DeltaEvalProperty {
  id: string;
  description: string;
  check(run: DeltaRun): boolean;
}

/** One pair run's inputs to the narrative and the delta, both over the filtered span. */
export interface RevisionSpanInputs {
  revised: EvalFixture;
  prevHeadSha: string;
  filteredSpan: string;
  /** What the delta sends; empty unless the case opts in. */
  reviewComments: readonly ReviewComment[];
  generator: Generator;
  effort: Effort;
}

/** The span inputs both calls read, before any model is chosen. */
export type RevisionSpanFixture = Pick<
  RevisionSpanInputs,
  "revised" | "prevHeadSha" | "filteredSpan" | "reviewComments"
>;

/** The PR's changed lines as the worker counts them: every file's additions and deletions. */
function countPrChangedLines(revised: EvalFixture): number {
  return revised.pr.meta.files.reduce(
    (sum, file) => sum + file.additions + file.deletions,
    0,
  );
}

function buildDeltaInput(source: RevisionSpanFixture): DeltaInput {
  const { revised } = source;
  return {
    locator: revised.pr.locator,
    meta: revised.pr.meta,
    baselineSha: source.prevHeadSha,
    headSha: revised.commitRange.head,
    baselineIndex: BASE_BRIEF_INDEX,
    headIndex: REVISED_BRIEF_INDEX,
    incrementalDiff: source.filteredSpan,
    links: revised.pr.links,
    primaryTicket: revised.pr.primaryTicket,
    comments: [...source.reviewComments],
  };
}

/**
 * Why the worker would write skip records for this span instead of calling
 * the model, by the checks that need no Brief: the huge-span ratio, then the
 * delta's call limits. The narrative's limits read the revised Brief, so its
 * run checks them before the call.
 */
export function readSpanSkip(
  source: RevisionSpanFixture,
  readsDelta: boolean,
): string | undefined {
  const isHuge = isHugeSpan(
    countChangedLines(source.filteredSpan),
    countPrChangedLines(source.revised),
  );
  if (isHuge) {
    return "the worker skips this span under the huge-span ratio, so no narrative or delta call runs";
  }
  if (readsDelta && exceedsDeltaCallLimits(buildDeltaInput(source))) {
    return "the span passes the delta call limits, so the worker skips the delta";
  }
  return undefined;
}

/** The revision narrative on the revised Brief, as the worker calls it after the Brief. */
export async function generateNarrativeRun(
  inputs: RevisionSpanInputs,
  brief: Brief,
): Promise<NarrativeRun> {
  const { revised } = inputs;
  const marksFiles = parseChangedRanges(inputs.filteredSpan);
  const narrativeInput: RevisionNarrativeInput = {
    locator: revised.pr.locator,
    meta: revised.pr.meta,
    prevHeadSha: inputs.prevHeadSha,
    headSha: revised.commitRange.head,
    prevIndex: BASE_BRIEF_INDEX,
    headIndex: REVISED_BRIEF_INDEX,
    incrementalDiff: inputs.filteredSpan,
    links: revised.pr.links,
    primaryTicket: revised.pr.primaryTicket,
    brief,
    marksFiles,
  };
  if (exceedsNarrativeCallLimits(narrativeInput)) {
    throw new Error(
      "the span passes the narrative call limits, so the worker skips the narrative; no call made",
    );
  }

  const narrative = await categorizeRevisionNarrative(
    narrativeInput,
    inputs.generator,
    () => {},
    inputs.effort,
  );
  return { brief, narrative, marksFiles, filteredSpan: inputs.filteredSpan };
}

/** The Delta Brief of a reviewer whose Checkpoint sits at the previous head. */
export async function generateDeltaRun(
  inputs: RevisionSpanInputs,
): Promise<DeltaRun> {
  const recorded = recordOutputs(inputs.generator);
  const deltaInput = buildDeltaInput(inputs);

  const delta = await categorizeDelta(
    deltaInput,
    recorded.generator,
    () => {},
    inputs.effort,
  );
  return {
    delta,
    filteredSpan: inputs.filteredSpan,
    reviewComments: inputs.reviewComments,
    unknownGroupChunkIds: listUnknownGroupChunkIds(recorded.outputs.at(-1)),
  };
}

interface RecordedGenerator {
  generator: Generator;
  outputs: unknown[];
}

/** A generator that keeps every model answer it passes on. */
function recordOutputs(inner: Generator): RecordedGenerator {
  const outputs: unknown[] = [];
  async function generate<Schema extends z.ZodType>(
    req: GenerateRequest<Schema>,
  ): Promise<z.infer<Schema>> {
    const output = await inner.generate(req);
    outputs.push(output);
    return output;
  }

  return {
    generator: { generate, origin: (effort) => inner.origin(effort) },
    outputs,
  };
}

/** Chunks of the model's delta answer naming a group the answer does not hold. */
function listUnknownGroupChunkIds(output: unknown): string[] {
  const answer = DeltaBriefGenerationSchema.parse(output);
  const groupIds = new Set(answer.changedGroups.map((group) => group.id));
  return answer.chunks
    .filter((chunk) => !groupIds.has(chunk.changeGroupId))
    .map((chunk) => chunk.id);
}
