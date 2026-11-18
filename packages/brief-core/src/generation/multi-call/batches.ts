import type { FileId, HunkId } from "../../diff/hunk-index/types";
import { DETAIL_BATCH_MAX_DIFF_TOKENS, DETAIL_BATCH_MAX_HUNKS } from "./consts";
import type { BatchPart, DetailBatch, DetailBatchPlanInput } from "./types";

function countHunks(parts: readonly BatchPart[]): number {
  return parts.reduce((sum, part) => sum + part.hunkIds.length, 0);
}

function buildBatch(index: number, parts: readonly BatchPart[]): DetailBatch {
  return { index, parts, hunkCount: countHunks(parts) };
}

interface BatchLimits {
  readonly maxHunks: number;
  readonly maxTokens: number;
  readonly hunkTokens: ReadonlyMap<HunkId, number>;
}

interface HunkRun {
  readonly hunkIds: readonly HunkId[];
  readonly tokens: number;
}

function measureRun(hunkIds: readonly HunkId[], limits: BatchLimits): HunkRun {
  let tokens = 0;
  for (const hunkId of hunkIds) {
    tokens += limits.hunkTokens.get(hunkId) ?? 0;
  }
  return { hunkIds, tokens };
}

function fitsLimits(
  hunkCount: number,
  tokens: number,
  limits: BatchLimits,
): boolean {
  return hunkCount <= limits.maxHunks && tokens <= limits.maxTokens;
}

/**
 * Consecutive runs joined while each pack stays within both limits. A run
 * over them is a pack of its own: a hunk is never cut here.
 */
function packRuns(runs: readonly HunkRun[], limits: BatchLimits): HunkRun[] {
  const packs: HunkRun[] = [];
  let current: HunkRun = { hunkIds: [], tokens: 0 };
  for (const run of runs) {
    const hunkCount = current.hunkIds.length + run.hunkIds.length;
    const overLimits = !fitsLimits(
      hunkCount,
      current.tokens + run.tokens,
      limits,
    );
    const closesPack = current.hunkIds.length > 0 && overLimits;
    if (closesPack) {
      packs.push(current);
      current = { hunkIds: [], tokens: 0 };
    }
    current = {
      hunkIds: [...current.hunkIds, ...run.hunkIds],
      tokens: current.tokens + run.tokens,
    };
  }
  if (current.hunkIds.length > 0) {
    packs.push(current);
  }
  return packs;
}

/** The file id a hunk id names: `f12h3` is file `f12`. */
function readFileId(hunkId: HunkId): FileId {
  const hunkMark = hunkId.indexOf("h");
  const fileId: FileId = `f${Number(hunkId.slice(1, hunkMark))}`;
  return fileId;
}

/** A group's hunks as runs of one file each, in diff order. */
function listFileRuns(hunkIds: readonly HunkId[]): HunkId[][] {
  const runs: HunkId[][] = [];
  let currentFile: FileId | undefined;
  for (const hunkId of hunkIds) {
    const fileId = readFileId(hunkId);
    if (fileId !== currentFile) {
      runs.push([]);
      currentFile = fileId;
    }
    runs.at(-1)?.push(hunkId);
  }
  return runs;
}

/** A file's hunks cut into the fewest consecutive pieces within both limits. */
function cutFileRun(run: readonly HunkId[], limits: BatchLimits): HunkRun[] {
  const singles = run.map((hunkId) => measureRun([hunkId], limits));
  return packRuns(singles, limits);
}

/**
 * An oversized group becomes its own parts, whole files packed within the
 * limits under the group's id; a file over them is cut into runs of hunks.
 */
function splitGroupByFile(
  groupId: string,
  hunkIds: readonly HunkId[],
  limits: BatchLimits,
): BatchPart[] {
  const pieces = listFileRuns(hunkIds).flatMap((run) =>
    cutFileRun(run, limits),
  );
  return packRuns(pieces, limits).map((pack) => ({
    groupId,
    hunkIds: pack.hunkIds,
  }));
}

/**
 * Whole groups in reading order, packed while a batch stays within the
 * hunk limit and the diff token budget. A group over either never shares a
 * batch: it becomes its own batches, split by file, each keeping the
 * group's id. A hunk over the budget alone rides a batch of its own.
 * Shortened files ride no batch: code writes their chunks, so they count
 * for nothing here.
 */
export function planDetailBatches(input: DetailBatchPlanInput): DetailBatch[] {
  const limits: BatchLimits = {
    maxHunks: input.maxHunks ?? DETAIL_BATCH_MAX_HUNKS,
    maxTokens: input.maxTokens ?? DETAIL_BATCH_MAX_DIFF_TOKENS,
    hunkTokens: input.hunkTokens,
  };
  const batches: DetailBatch[] = [];
  let current: BatchPart[] = [];
  let currentCount = 0;
  let currentTokens = 0;

  function flush(): void {
    if (current.length > 0) {
      batches.push(buildBatch(batches.length, current));
    }
    current = [];
    currentCount = 0;
    currentTokens = 0;
  }

  for (const groupId of input.groupIds) {
    const hunkIds = input.hunksByGroup.get(groupId) ?? [];
    if (hunkIds.length === 0) {
      continue;
    }
    const { tokens } = measureRun(hunkIds, limits);
    if (!fitsLimits(hunkIds.length, tokens, limits)) {
      flush();
      for (const part of splitGroupByFile(groupId, hunkIds, limits)) {
        batches.push(buildBatch(batches.length, [part]));
      }
      continue;
    }
    const joinedCount = currentCount + hunkIds.length;
    const joinedTokens = currentTokens + tokens;
    if (!fitsLimits(joinedCount, joinedTokens, limits)) {
      flush();
    }
    current.push({ groupId, hunkIds });
    currentCount += hunkIds.length;
    currentTokens += tokens;
  }
  flush();
  return batches;
}

/**
 * Two halves of a batch whose answer was cut at the output cap, or undefined
 * for a batch of one hunk, which has no halves. The cut falls at the hunk
 * midpoint, so each half holds half the hunks; a part the cut crosses keeps
 * its group id on both halves, which may split a file, never a hunk. Each
 * half keeps the batch's index with a half number.
 */
export function splitBatch(
  batch: DetailBatch,
): [DetailBatch, DetailBatch] | undefined {
  if (batch.hunkCount < 2) {
    return undefined;
  }
  const head: BatchPart[] = [];
  const tail: BatchPart[] = [];
  let headRoom = Math.ceil(batch.hunkCount / 2);
  for (const { groupId, hunkIds } of batch.parts) {
    const kept = hunkIds.slice(0, headRoom);
    const rest = hunkIds.slice(kept.length);
    headRoom -= kept.length;
    if (kept.length > 0) {
      head.push({ groupId, hunkIds: kept });
    }
    if (rest.length > 0) {
      tail.push({ groupId, hunkIds: rest });
    }
  }
  return [buildHalf(batch, 1, head), buildHalf(batch, 2, tail)];
}

function buildHalf(
  batch: DetailBatch,
  half: 1 | 2,
  parts: readonly BatchPart[],
): DetailBatch {
  return { ...buildBatch(batch.index, parts), half };
}
