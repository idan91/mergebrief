import type { z } from "zod/v4";
import { isSpanUnchanged } from "brief-core/pr-span";
import {
  categorizeDelta,
  categorizeRevisionNarrative,
  countChangedLines,
  exceedsDeltaCallLimits,
  exceedsNarrativeCallLimits,
  isHugeSpan,
  parseChangedRanges,
  restoreRawPaths,
  shapeDeltaUnchanged,
  splitDiffByFile,
  type DeltaInput,
  type RevisionChangeFile,
  type RevisionNarrativeInput,
} from "brief-core";
import {
  DeltaBriefGenerationSchema,
  RevisionNarrativeGenerationSchema,
  type Brief,
  type DeltaBrief,
  type DeltaUnchanged,
  type LineRange,
  type ReviewComment,
  type RevisionNarrative,
  type RevisionNarrativeUnchanged,
} from "brief-core/types";
import type { Effort, GenerateRequest, Generator } from "generators";
import type { EvalFixture } from "./loadCase";

type DeltaBriefGeneration = z.infer<typeof DeltaBriefGenerationSchema>;

/** Brief indexes the pair's two heads take, the base first. */
export const BASE_BRIEF_INDEX = 1;
export const REVISED_BRIEF_INDEX = 2;

/** A chunk's file and ranges as the model answered, its raw path restored, before alignment clips them. */
export interface ModelChunk {
  file: string;
  addedRanges: readonly LineRange[];
  removedRanges: readonly LineRange[];
}

/**
 * What a narrative property reads: the narrative, or the no-change record an
 * empty span writes, the Brief it aligned to, the span's marks and the model
 * calls the run made.
 */
export interface NarrativeRun {
  brief: Brief;
  narrative: RevisionNarrative | RevisionNarrativeUnchanged;
  /** What the no-replay check reads: alignment clips base noise out of the stored ranges. */
  modelChunks: readonly ModelChunk[];
  marksFiles: RevisionChangeFile[];
  filteredSpan: string;
  unfilteredSpan: string;
  modelCalls: number;
}

/** What a delta property reads; `unknownGroupChunkIds` are chunks the pipeline dropped before `delta`. */
export interface DeltaRun {
  delta: DeltaBrief | DeltaUnchanged;
  /** The model's chunks under a known group, for the no-replay check. */
  modelChunks: readonly ModelChunk[];
  filteredSpan: string;
  unfilteredSpan: string;
  reviewComments: readonly ReviewComment[];
  unknownGroupChunkIds: readonly string[];
  modelCalls: number;
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
  /** Read only by the no-replay predicates: the lines it changes that `filteredSpan` does not are base noise. */
  unfilteredSpan: string;
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

/**
 * The revision narrative on the revised Brief, as the worker calls it after
 * the Brief; an empty span writes the no-change record and calls no model.
 */
export async function generateNarrativeRun(
  inputs: RevisionSpanInputs,
  brief: Brief,
): Promise<NarrativeRun> {
  const { revised } = inputs;
  const marksFiles = parseChangedRanges(inputs.filteredSpan);
  const recorded = recordOutputs(inputs.generator);
  if (isSpanUnchanged(inputs.filteredSpan)) {
    const unchanged: RevisionNarrativeUnchanged = {
      artifactKind: "revisionNarrativeUnchanged",
      pr: brief.pr,
      prevHeadSha: inputs.prevHeadSha,
      headSha: revised.commitRange.head,
      prevIndex: BASE_BRIEF_INDEX,
      headIndex: REVISED_BRIEF_INDEX,
    };
    return {
      brief,
      narrative: unchanged,
      modelChunks: [],
      marksFiles,
      filteredSpan: inputs.filteredSpan,
      unfilteredSpan: inputs.unfilteredSpan,
      modelCalls: recorded.outputs.length,
    };
  }
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
    recorded.generator,
    () => {},
    inputs.effort,
  );
  const answer = RevisionNarrativeGenerationSchema.parse(
    recorded.outputs.at(-1),
  );
  const rawPaths = [
    ...brief.chunks.map((chunk) => chunk.file),
    ...listSpanPaths(inputs.filteredSpan),
  ];
  return {
    brief,
    narrative,
    modelChunks: restoreRawPaths(answer.chunks, rawPaths),
    marksFiles,
    filteredSpan: inputs.filteredSpan,
    unfilteredSpan: inputs.unfilteredSpan,
    modelCalls: recorded.outputs.length,
  };
}

/**
 * The Delta Brief of a reviewer whose Checkpoint sits at the previous head;
 * an empty span writes the no-change record and calls no model.
 */
export async function generateDeltaRun(
  inputs: RevisionSpanInputs,
): Promise<DeltaRun> {
  const { revised } = inputs;
  const recorded = recordOutputs(inputs.generator);
  if (isSpanUnchanged(inputs.filteredSpan)) {
    const unchanged = shapeDeltaUnchanged({
      locator: revised.pr.locator,
      meta: revised.pr.meta,
      baselineSha: inputs.prevHeadSha,
      headSha: revised.commitRange.head,
      baselineIndex: BASE_BRIEF_INDEX,
      headIndex: REVISED_BRIEF_INDEX,
    });
    return {
      delta: unchanged,
      modelChunks: [],
      filteredSpan: inputs.filteredSpan,
      unfilteredSpan: inputs.unfilteredSpan,
      reviewComments: inputs.reviewComments,
      unknownGroupChunkIds: [],
      modelCalls: recorded.outputs.length,
    };
  }
  const deltaInput = buildDeltaInput(inputs);

  const delta = await categorizeDelta(
    deltaInput,
    recorded.generator,
    () => {},
    inputs.effort,
  );
  const answer = DeltaBriefGenerationSchema.parse(recorded.outputs.at(-1));
  const knownChunks = listKnownGroupChunks(answer);
  return {
    delta,
    modelChunks: restoreRawPaths(
      knownChunks,
      listSpanPaths(inputs.filteredSpan),
    ),
    filteredSpan: inputs.filteredSpan,
    unfilteredSpan: inputs.unfilteredSpan,
    reviewComments: inputs.reviewComments,
    unknownGroupChunkIds: listUnknownGroupChunkIds(answer),
    modelCalls: recorded.outputs.length,
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

function listSpanPaths(span: string): string[] {
  return splitDiffByFile(span).map((fileDiff) => fileDiff.file);
}

function hasKnownGroup(
  answer: DeltaBriefGeneration,
  chunk: DeltaBriefGeneration["chunks"][number],
): boolean {
  return answer.changedGroups.some((group) => group.id === chunk.changeGroupId);
}

/** Chunks of the model's delta answer naming a group the answer holds: the ones the pipeline keeps. */
function listKnownGroupChunks(
  answer: DeltaBriefGeneration,
): DeltaBriefGeneration["chunks"] {
  return answer.chunks.filter((chunk) => hasKnownGroup(answer, chunk));
}

/** Chunks of the model's delta answer naming a group the answer does not hold. */
function listUnknownGroupChunkIds(answer: DeltaBriefGeneration): string[] {
  return answer.chunks
    .filter((chunk) => !hasKnownGroup(answer, chunk))
    .map((chunk) => chunk.id);
}
