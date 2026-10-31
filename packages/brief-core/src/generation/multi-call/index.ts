import {
  GeneratorError,
  GeneratorErrorKinds,
  type GenerateRequest,
  type Generator,
  type Logger,
} from "generators";
import type { z } from "zod/v4";
import { splitDiffByFile } from "../../diff/file-diff";
import { indexDiff } from "../../diff/hunk-index";
import type { FileId, HunkId, IndexedFile } from "../../diff/hunk-index/types";
import {
  detailGenerationSchemaWith,
  GroupingGenerationSchema,
  type Brief,
  type ChangeGroup,
  type Chunk,
  type ChunkGeneration,
  type DetailGeneration,
  type GroupingGeneration,
} from "../../types";
import {
  acceptRepoContext,
  buildPrRef,
  buildValidationContext,
  SALVAGE_FIELDS,
  type AcceptedRepoContext,
  type DraftBrief,
} from "../categorize";
import { buildConcernView, deriveChunkLoc, diffLocTotals } from "../loc";
import { chooseOutline } from "../outline";
import type { Outline } from "../outline/types";
import {
  buildShortenedChunk,
  LockfileReadFailures,
  shortenFile,
  summarizeUnreadLockfile,
} from "../shortened";
import {
  parseGitAttributes,
  readLinguistAttributesByPath,
} from "../shortened/gitattributes";
import type {
  LinguistRule,
  LockfileSummary,
  ShortenedFile,
} from "../shortened/types";
import { snapChunkRanges } from "../snap-ranges";
import { restoreRawGroupIds, restoreRawPaths } from "../untrusted-text";
import { dropUnknownGroupChunks, fanOutIntentCheck } from "../validate";
import { planDetailBatches, splitBatch } from "./batches";
import { dropEmptyGroups } from "./empty-groups";
import {
  DEFAULT_DETAIL_CONCURRENCY,
  DETAIL_MAX_OUTPUT_TOKENS,
  GROUPING_MAX_OUTPUT_TOKENS,
  GROUPING_SALVAGE_FIELDS,
  PART_KEY_GROUPING,
} from "./consts";
import {
  buildDetailPrefix,
  buildDetailRequest,
  indexDetailHunks,
  readHunkTokens,
} from "./detail";
import { buildGroupingRequest } from "./grouping";
import { resolveHunkMap } from "./hunk-map";
import {
  mapStoredGroupIds,
  renameChunkGroupIds,
  renumberGroupIds,
} from "./renumber";
import { GenerationWarningKinds } from "../warnings/types";
import { clampToShownLines } from "./shown-lines";
import type {
  DetailBatch,
  DetailRequest,
  HunkLocation,
  MultiCallHooks,
  MultiCallOptions,
  PartKey,
  ResolvedHunkMap,
  StoredGroupIds,
} from "./types";

const DETAIL_BATCH_CHECK = "detail batch";

/** `detail:<n>`, or `detail:<n>:<half>` for a half of a cut batch. */
export function readPartKey(batch: DetailBatch): PartKey {
  const base: PartKey = `detail:${batch.index + 1}`;
  return batch.half === undefined ? base : `${base}:${batch.half}`;
}

/** A stored part is reused only when it still parses as its schema. */
async function loadStoredPart<S extends z.ZodType>(
  hooks: MultiCallHooks | undefined,
  key: PartKey,
  schema: S,
): Promise<z.infer<S> | undefined> {
  const stored = await hooks?.loadPart?.(key);
  if (stored === undefined) {
    return undefined;
  }
  const parsed = schema.safeParse(stored);
  return parsed.success ? parsed.data : undefined;
}

/**
 * Whether the span holds a grouping part that still parses: an earlier
 * attempt already went multi-call, so resuming its parts beats paying for
 * a single call first. A read that fails is logged and counts as none.
 */
export async function hasStoredGrouping(
  hooks: MultiCallHooks,
  log: Logger,
): Promise<boolean> {
  try {
    const stored = await loadStoredPart(
      hooks,
      PART_KEY_GROUPING,
      GroupingGenerationSchema,
    );
    return stored !== undefined;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    log(`${PART_KEY_GROUPING}: no stored part read (${reason})`);
    return false;
  }
}

/**
 * The summary a lockfile reads by. One the caller never summarized, past the
 * worker's read cap or with no caller summaries at all, reads unread, so it
 * is never read in full.
 */
function readLockfileSummary(
  path: string,
  summaries: ReadonlyMap<string, LockfileSummary>,
): LockfileSummary | undefined {
  return (
    summaries.get(path) ??
    summarizeUnreadLockfile(path, LockfileReadFailures.UNAVAILABLE)
  );
}

/** A refused `.gitattributes` sets no rule, so every file reads in full. */
function readGitAttributeRules(options: MultiCallOptions): LinguistRule[] {
  if (options.gitAttributes === undefined) {
    return [];
  }
  const parsed = parseGitAttributes(options.gitAttributes);
  if (!parsed.ok) {
    options.log(`.gitattributes not applied: ${parsed.error}`);
    return [];
  }
  return parsed.value;
}

/** `.gitattributes` is read once per run; the lockfile summaries name the rest. */
function listShortenedFiles(
  files: readonly IndexedFile[],
  options: MultiCallOptions,
): Map<FileId, ShortenedFile> {
  const rules = readGitAttributeRules(options);
  const { byPath, unresolvedPathCount } = readLinguistAttributesByPath(
    files.map((file) => file.path),
    rules,
  );
  if (unresolvedPathCount > 0) {
    options.log(
      `.gitattributes match budget ran out: ${unresolvedPathCount} files read in full`,
    );
  }

  const shortened = new Map<FileId, ShortenedFile>();
  for (const file of files) {
    const read = shortenFile(
      file,
      byPath.get(file.path),
      readLockfileSummary(file.path, options.lockfileSummaries),
    );
    if (read !== undefined) {
      shortened.set(file.id, read);
    }
  }
  return shortened;
}

/** Reading order first, then every group it left out, in list order. */
function orderGroups(grouping: GroupingGeneration): ChangeGroup[] {
  const byId = new Map(grouping.changeGroups.map((group) => [group.id, group]));
  const ordered: ChangeGroup[] = [];
  const ids = [
    ...(grouping.readingOrder ?? []).map((step) => step.groupId),
    ...grouping.changeGroups.map((group) => group.id),
  ];
  for (const id of ids) {
    const group = byId.get(id);
    if (group !== undefined && !ordered.includes(group)) {
      ordered.push(group);
    }
  }
  return ordered;
}

/** The lane count the pool runs; a count that is not a whole number of 1 or more is a caller's bug. */
function readLaneLimit(limit: number | undefined): number {
  if (limit === undefined) {
    return DEFAULT_DETAIL_CONCURRENCY;
  }
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError(
      `detailConcurrency must be a whole number of 1 or more; got ${limit}`,
    );
  }
  return limit;
}

/** What the grouping and detail steps both read, computed once per run. */
interface RunInputs {
  readonly files: readonly IndexedFile[];
  readonly shortened: ReadonlyMap<FileId, ShortenedFile>;
  readonly shortenedFileIds: ReadonlySet<FileId>;
  /** Every hunk a detail call may show, redacted and weighed once. */
  readonly locations: ReadonlyMap<HunkId, HunkLocation>;
  readonly accepted: AcceptedRepoContext;
}

/** The hunks the outline marks: every hunk of a file read in full. */
function countMarkedHunks(inputs: RunInputs): number {
  let count = 0;
  for (const file of inputs.files) {
    if (!inputs.shortened.has(file.id)) {
      count += file.hunks.length;
    }
  }
  return count;
}

/**
 * Runs `work` over `items` with at most `limit` in flight; results land by
 * position. The first failure stops every lane from taking another item, and
 * the pool waits for the calls already in flight so each stores its part and
 * a retry pays only for the missing ones; then it rethrows that failure.
 * Shutdown and supersession abort the calls through the generator.
 */
async function runPool<Item, Output>(
  items: readonly Item[],
  limit: number,
  work: (item: Item) => Promise<Output>,
): Promise<Output[]> {
  const results: Output[] = [];
  let failure: { error: unknown } | undefined;
  let next = 0;
  async function drain(): Promise<void> {
    while (next < items.length && failure === undefined) {
      const position = next;
      next += 1;
      const item = items[position];
      if (item === undefined) {
        continue;
      }
      try {
        // oxlint-disable-next-line no-await-in-loop -- each lane runs its items one at a time
        results[position] = await work(item);
      } catch (error) {
        failure ??= { error };
      }
    }
  }
  const lanes = Array.from({ length: Math.min(limit, items.length) }, drain);
  await Promise.allSettled(lanes);
  if (failure !== undefined) {
    throw failure.error;
  }
  return results;
}

interface GroupingStep {
  grouping: GroupingGeneration;
  groups: ChangeGroup[];
  resolved: ResolvedHunkMap;
  batches: DetailBatch[];
  /** The user message the summary was written against; the unseen-link check reads it. */
  prompt: string;
  primaryText: string;
  /** The stored grouping part was reused, so the stored detail parts still name this run's batches. */
  groupingReused: boolean;
  storedGroupIds: StoredGroupIds;
}

async function runGroupingCall(
  options: MultiCallOptions,
  inputs: RunInputs,
  outline: Outline,
): Promise<GroupingStep> {
  const { pr, generator, hooks, log, warnings } = options;
  const hunkCount = countMarkedHunks(inputs);
  const request = buildGroupingRequest({
    pr,
    outline,
    hunkCount,
    accepted: inputs.accepted,
  });

  const stored = await loadStoredPart(
    hooks,
    PART_KEY_GROUPING,
    GroupingGenerationSchema,
  );
  const generated =
    stored ??
    (await generator.generate({
      schema: GroupingGenerationSchema,
      system: request.system,
      user: request.user,
      effort: options.groupingEffort,
      label: PART_KEY_GROUPING,
      salvageFields: GROUPING_SALVAGE_FIELDS,
      maxOutputTokens: GROUPING_MAX_OUTPUT_TOKENS,
      log,
      onWarning: warnings.recordGeneratorWarning,
    }));
  const reservedGroupIds = options.reservedGroupIds ?? [];
  const grouping =
    reservedGroupIds.length === 0
      ? generated
      : renumberGroupIds(generated, reservedGroupIds);
  if (stored === undefined) {
    await hooks?.onPartDone?.(PART_KEY_GROUPING, grouping);
  } else {
    log(`${PART_KEY_GROUPING}: reusing the stored part`);
  }

  const groups = orderGroups(grouping);
  const groupIds = groups.map((group) => group.id);
  const resolved = resolveHunkMap({
    entries: grouping.hunkMap,
    files: inputs.files,
    shortenedFileIds: inputs.shortenedFileIds,
    groupIds,
    warnings,
  });
  const batches = planDetailBatches({
    groupIds,
    hunksByGroup: resolved.hunksByGroup,
    hunkTokens: readHunkTokens(inputs.locations),
  });
  log(`detail: ${batches.length} call(s) over ${hunkCount} hunks`);
  await hooks?.onGroupingDone?.({ detailCalls: batches.length });

  return {
    grouping,
    groups,
    resolved,
    batches,
    prompt: request.user,
    primaryText: request.primaryText,
    groupingReused: stored !== undefined,
    storedGroupIds: mapStoredGroupIds(stored ?? grouping, grouping),
  };
}

interface DetailOutcome {
  batch: DetailBatch;
  chunks: ChunkGeneration[];
}

interface DetailStep {
  options: MultiCallOptions;
  generator: Generator;
  schema: z.ZodType<DetailGeneration>;
  buildRequest: (batch: DetailBatch) => DetailRequest;
  /** False after a fresh grouping call: a stored detail part was planned by an earlier grouping and names batches this run never made. */
  reusesStoredParts: boolean;
  storedGroupIds: StoredGroupIds;
}

/** The one generator failure the engine recovers from: an answer cut at its output cap. */
export function isOutputCut(error: unknown): boolean {
  return (
    error instanceof GeneratorError &&
    error.kind === GeneratorErrorKinds.OUTPUT_CUT
  );
}

/** A whole batch of two or more hunks has halves; a half never splits again. */
function readHalves(
  batch: DetailBatch,
): [DetailBatch, DetailBatch] | undefined {
  return batch.half === undefined ? splitBatch(batch) : undefined;
}

/**
 * A batch whose answer was cut splits once into two halves, run one after
 * the other in the same lane, each its own resume part. A half that is cut
 * again fails the run.
 */
async function runSplitDetailCall(
  batch: DetailBatch,
  halves: readonly [DetailBatch, DetailBatch],
  step: DetailStep,
): Promise<DetailOutcome> {
  const key = readPartKey(batch);
  step.options.warnings.report({
    kind: GenerationWarningKinds.DETAIL_CALL_CUT,
    message: `${key}: the answer reached the output cap; the batch ran as two halves`,
    partKey: key,
  });
  const [head, tail] = halves;
  const first = await runDetailCall(head, step);
  const second = await runDetailCall(tail, step);
  return { batch, chunks: [...first.chunks, ...second.chunks] };
}

/** A batch split on an earlier run stored its halves, never the whole: resume goes straight to them. */
async function hasStoredHalf(
  head: DetailBatch,
  step: DetailStep,
): Promise<boolean> {
  if (!step.reusesStoredParts) {
    return false;
  }
  const stored = await loadStoredPart(
    step.options.hooks,
    readPartKey(head),
    step.schema,
  );
  return stored !== undefined;
}

async function runDetailCall(
  batch: DetailBatch,
  step: DetailStep,
): Promise<DetailOutcome> {
  const { hooks, log } = step.options;
  const key = readPartKey(batch);
  const stored = step.reusesStoredParts
    ? await loadStoredPart(hooks, key, step.schema)
    : undefined;
  if (stored !== undefined) {
    log(`${key}: reusing the stored part`);
    const chunks = renameChunkGroupIds(
      stored.chunks,
      step.storedGroupIds.toRun,
    );
    return { batch, chunks };
  }
  const halves = readHalves(batch);
  const resumesSplit =
    halves !== undefined && (await hasStoredHalf(halves[0], step));
  if (resumesSplit) {
    return runSplitDetailCall(batch, halves, step);
  }
  try {
    return await runFreshDetailCall(batch, step);
  } catch (error) {
    const splitsOnCut = isOutputCut(error) && halves !== undefined;
    if (!splitsOnCut) {
      throw error;
    }
    return runSplitDetailCall(batch, halves, step);
  }
}

async function runFreshDetailCall(
  batch: DetailBatch,
  step: DetailStep,
): Promise<DetailOutcome> {
  const { hooks, log } = step.options;
  const key = readPartKey(batch);

  const request = step.buildRequest(batch);
  const generateRequest: GenerateRequest<z.ZodType<DetailGeneration>> = {
    schema: step.schema,
    system: request.system,
    userPrefix: request.userPrefix,
    user: request.user,
    effort: step.options.detailEffort,
    label: key,
    salvageFields: SALVAGE_FIELDS,
    maxOutputTokens: DETAIL_MAX_OUTPUT_TOKENS,
    log,
    onWarning: step.options.warnings.recordGeneratorWarning,
  };
  const output = await step.generator.generate(generateRequest);
  const shown = restoreRawGroupIds(output.chunks, listBatchGroupIds(batch));
  await hooks?.onPartDone?.(key, {
    ...output,
    chunks: renameChunkGroupIds(shown, step.storedGroupIds.toStored),
  });
  return { batch, chunks: output.chunks };
}

/** Call 1 alone warms the shared prefix's cache; the rest run up to `detailConcurrency` at once. */
async function runDetailCalls(
  options: MultiCallOptions,
  inputs: RunInputs,
  step: GroupingStep,
  laneLimit: number,
): Promise<DetailOutcome[]> {
  const { locations, accepted } = inputs;
  const customNames =
    accepted.context?.customAttributes.map((attr) => attr.name) ?? [];
  const prefix = buildDetailPrefix({
    pr: options.pr,
    summary: step.grouping.summary,
    groups: step.groups,
    hunksByGroup: step.resolved.hunksByGroup,
    repoContext: accepted.context,
    attributesBlock: accepted.attributesBlock,
  });
  const detail: DetailStep = {
    options,
    generator: options.generator,
    schema: detailGenerationSchemaWith(customNames),
    buildRequest: (batch) =>
      buildDetailRequest({
        batch,
        batchCount: step.batches.length,
        locations,
        prefix,
        repoContext: accepted.context,
        attributesBlock: accepted.attributesBlock,
      }),
    reusesStoredParts: step.groupingReused,
    storedGroupIds: step.storedGroupIds,
  };

  const [first, ...rest] = step.batches;
  if (first === undefined) {
    return [];
  }
  await options.hooks?.onDetailStart?.();
  const firstOutcome = await runDetailCall(first, detail);
  const restOutcomes = await runPool(rest, laneLimit, (batch) =>
    runDetailCall(batch, detail),
  );
  return [firstOutcome, ...restOutcomes];
}

/** The groups a batch shows, each once; the merge and the stored part read a chunk's id against these. */
function listBatchGroupIds(batch: DetailBatch): string[] {
  return [...new Set(batch.parts.map((part) => part.groupId))];
}

/**
 * Every batch's chunks in batch order, each batch's chunks kept to the
 * groups of that batch, ids renumbered over the merged sequence since a
 * detail call numbers its own.
 */
function mergeDetailChunks(
  outcomes: readonly DetailOutcome[],
  options: MultiCallOptions,
): ChunkGeneration[] {
  const merged: ChunkGeneration[] = [];
  for (const outcome of outcomes) {
    const batchGroupIds = listBatchGroupIds(outcome.batch);
    const restored = restoreRawGroupIds(outcome.chunks, batchGroupIds);
    const known = dropUnknownGroupChunks(
      batchGroupIds.map((id) => ({ id })),
      restored,
    );
    options.warnings.reportIssues(
      `${DETAIL_BATCH_CHECK} ${readPartKey(outcome.batch)}`,
      known.issues,
    );
    merged.push(...known.chunks);
  }
  return numberChunks(merged);
}

/** `chunks` numbered `c1` on in order; each detail call numbers its own, and the clamp may drop one. */
function numberChunks<Numbered extends { id: string }>(
  chunks: readonly Numbered[],
): Numbered[] {
  return chunks.map((chunk, position) => ({
    ...chunk,
    id: `c${position + 1}`,
  }));
}

/** One chunk per shortened file a group owns, ids continuing after the detail chunks. */
function buildShortenedChunks(
  shortened: ReadonlyMap<FileId, ShortenedFile>,
  resolved: ResolvedHunkMap,
  firstPosition: number,
): Chunk[] {
  const chunks: Chunk[] = [];
  for (const read of shortened.values()) {
    const groupId = resolved.groupByShortenedFile.get(read.file.id);
    if (groupId === undefined) {
      continue;
    }
    const id = `c${firstPosition + chunks.length}`;
    chunks.push(buildShortenedChunk(read, { id, changeGroupId: groupId }));
  }
  return chunks;
}

/**
 * One multi-call generation: the grouping call over the outline, then the
 * detail calls over the batches; code merges the answers and stamps the
 * outline form. Nothing here validates; `validateFinalBrief` runs once over
 * the merged brief, and no anchor plan applies: every group is re-looked,
 * and with a previous brief the group ids are minted past the chain's.
 */
export async function generateMultiCallBrief(
  options: MultiCallOptions,
): Promise<DraftBrief> {
  const { pr, generator, log, warnings } = options;
  const laneLimit = readLaneLimit(options.detailConcurrency);
  const files = indexDiff(pr.diff);
  const shortened = listShortenedFiles(files, options);
  const outline = chooseOutline({
    files,
    shortened,
    forcedForm: options.forcedOutlineForm,
  });
  log(
    `outline: ${outline.form} (estimated input ${outline.estimatedInputTokens} tokens)`,
  );
  const shortenedFileIds = new Set(shortened.keys());
  const inputs: RunInputs = {
    files,
    shortened,
    shortenedFileIds,
    locations: indexDetailHunks(files, shortenedFileIds),
    accepted: acceptRepoContext(
      options.repoContext,
      pr.meta.files,
      log,
      warnings,
    ),
  };

  const step = await runGroupingCall(options, inputs, outline);
  const outcomes = await runDetailCalls(options, inputs, step, laneLimit);

  const fileDiffs = splitDiffByFile(pr.diff);
  const rawPaths = [
    ...pr.meta.files.map((file) => file.path),
    ...fileDiffs.map((fileDiff) => fileDiff.file),
  ];
  const context = buildValidationContext(
    pr,
    fileDiffs,
    inputs.accepted.context,
    step.primaryText,
    step.prompt,
  );
  const changedFiles = [...context.changedFiles];
  const merged = mergeDetailChunks(outcomes, options);
  const restored = restoreRawPaths(merged, rawPaths);
  const snapped = snapChunkRanges(restored, fileDiffs);
  const shown = clampToShownLines(snapped, inputs.locations, warnings);
  const detailChunks = deriveChunkLoc(numberChunks(shown), changedFiles);
  const chunks = [
    ...detailChunks,
    ...buildShortenedChunks(shortened, step.resolved, detailChunks.length + 1),
  ];

  const {
    readingOrder,
    intentCheck,
    hunkMap: _resolved,
    ...rest
  } = step.grouping;
  const kept = dropEmptyGroups(
    {
      changeGroups: rest.changeGroups,
      readingOrder,
      intentCheck: fanOutIntentCheck(intentCheck),
    },
    chunks,
    warnings,
  );
  const brief: Brief = {
    ...rest,
    changeGroups: kept.changeGroups,
    chunks,
    concernView: buildConcernView(chunks),
    diffTotals: diffLocTotals(changedFiles),
    intentCheck: kept.intentCheck,
    pr: buildPrRef(pr.locator, pr.meta, options.commitRange.head),
    index: options.headIndex,
    commitRange: options.commitRange,
    generation: generator.origin(options.detailEffort),
    outlineForm: outline.form,
  };
  if (kept.readingOrder !== undefined) {
    brief.readingOrder = kept.readingOrder;
  }
  return { brief, context };
}
