import { GRAMMAR_BUDGET_BYTES } from "./consts";
import { resolveGrammar } from "./grammarMap";
import { planGrammarBudget } from "./planGrammarBudget";
import { replyEnvelopeSchema } from "./schemas";
import {
  ChunkTokenStatuses,
  TokenFailureReasons,
  TokenMessageKinds,
  type BriefChunkSize,
  type CancelRequest,
  type ChunkTokensHandle,
  type ChunkTokensRequest,
  type ChunkTokensResult,
  type DiffLine,
  type DiffTokenWorkerHandle,
  type FileGrammarRows,
  type GrammarBudgetPlan,
  type GrammarName,
  type ReplyEnvelope,
  type RowTokenEntry,
  type TokenizableRow,
  type TokenizeRequest,
  type WarmRequest,
} from "./types";
import { isChunkTokenizable } from "./utils";

type SettleChunkTokens = (result: ChunkTokensResult) => void;

interface ChunkRequestRecord {
  requestId: number;
  briefKey: string;
  chunkKey: string;
  chunkId: string;
  promise: Promise<ChunkTokensResult>;
  settle: SettleChunkTokens;
  waiters: number;
}

const PLAIN_RESULT: ChunkTokensResult = { status: ChunkTokenStatuses.PLAIN };
const CANCELLED_RESULT: ChunkTokensResult = {
  status: ChunkTokenStatuses.FAILED,
  reason: TokenFailureReasons.CANCELLED,
};

// A brief is immutable for the life of the page, so a chunk's colour is too.
// Chunk cards are virtualized: without this a card pays the whole round trip
// again every time it scrolls back into the window. Keys carry the brief
// because chunk ids restart at the first chunk of every brief. A grammar that
// failed to load is the one outcome not kept, because the worker forgets a
// rejected load so the next request retries it.
interface SettledEntry {
  briefKey: string;
  result: ChunkTokensResult;
}

const settledResults = new Map<string, SettledEntry>();
const recordsByChunk = new Map<string, ChunkRequestRecord>();
const recordsByRequest = new Map<number, ChunkRequestRecord>();

let workerHandle: DiffTokenWorkerHandle;
let workerFailed = false;
let currentBriefKey: string | undefined;
let nextRequestId = 0;

/**
 * One worker per page. `undefined` where the runtime has no Worker at all,
 * which is every SSR render and every jsdom suite, so callers render plain
 * rather than branching on the environment themselves. A worker that has
 * failed once is never rebuilt: colour is an enhancement, and a restart loop
 * would leave every later chunk waiting on a reply it never gets.
 */
export function getDiffTokenWorker(): DiffTokenWorkerHandle {
  if (typeof Worker === "undefined") return undefined;
  if (workerFailed) return undefined;

  workerHandle ??= startWorker();

  return workerHandle;
}

/**
 * Loads the engine, theme and a brief's grammars before the first chunk asks,
 * and retires the brief the reader navigated away from. A child effect runs
 * before its parent's, so a chunk of the new brief can be requested before
 * this warm lands; that is why the cache key carries the brief rather than
 * relying on eviction order.
 */
export function warmDiffTokenWorker(
  briefKey: string,
  grammars: readonly GrammarName[],
): void {
  if (briefKey !== currentBriefKey) {
    currentBriefKey = briefKey;
    evictOtherBriefs(briefKey);
  }

  const worker = getDiffTokenWorker();
  if (worker === undefined) return;

  const message: WarmRequest = {
    kind: TokenMessageKinds.WARM,
    grammars: [...grammars],
  };
  // A Worker's postMessage takes no target origin; the rule reads window's.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  worker.postMessage(message);
}

/**
 * Never rejects: a chunk we will not colour, and a worker that failed, both
 * settle as a status the caller renders. The main thread owns the grammar,
 * ceiling and budget decisions so a refused chunk costs no message at all.
 */
export function requestChunkTokens(
  request: ChunkTokensRequest,
): ChunkTokensHandle {
  const chunkKey = buildChunkKey(request.briefKey, request.chunkId);
  const settled = settledResults.get(chunkKey);
  if (settled !== undefined) return shapeSettledHandle(settled.result);

  const grammar = resolveGrammar(request.filePath);
  if (grammar === undefined) return shapeSettledHandle(PLAIN_RESULT);

  const withinCeiling = isChunkTokenizable(request.rows.length);
  const admitted = request.admitted.has(grammar);
  if (!withinCeiling || !admitted) return shapeSettledHandle(PLAIN_RESULT);

  const worker = getDiffTokenWorker();
  if (worker === undefined) return shapeSettledHandle(PLAIN_RESULT);

  const running = recordsByChunk.get(chunkKey);
  if (running !== undefined) return joinRecord(running);

  return startRecord(worker, request, chunkKey, grammar);
}

/** The grammars a whole brief may load, decided once before any chunk opens. */
export function planBriefGrammars(
  chunks: readonly BriefChunkSize[],
): GrammarBudgetPlan {
  const files: FileGrammarRows[] = [];

  for (const chunk of chunks) {
    const grammar = resolveGrammar(chunk.file);
    if (grammar === undefined) continue;
    if (!isChunkTokenizable(chunk.rowCount)) continue;

    files.push({ grammar, rowCount: chunk.rowCount });
  }

  return planGrammarBudget(files, GRAMMAR_BUDGET_BYTES);
}

/** Test seam: drops the page's worker, its cache and every reply still owed. */
export function resetDiffTokenWorker(): void {
  workerHandle?.terminate();
  workerHandle = undefined;
  workerFailed = false;
  currentBriefKey = undefined;
  settledResults.clear();
  recordsByChunk.clear();
  recordsByRequest.clear();
  nextRequestId = 0;
}

function shapeSettledHandle(result: ChunkTokensResult): ChunkTokensHandle {
  return { promise: Promise.resolve(result), cancel: noCancel };
}

function noCancel(): void {}

function joinRecord(record: ChunkRequestRecord): ChunkTokensHandle {
  record.waiters += 1;

  return { promise: record.promise, cancel: () => releaseRecord(record) };
}

function buildChunkKey(briefKey: string, chunkId: string): string {
  return `${briefKey}:${chunkId}`;
}

// Two phases: collect, then drop. Releasing a record deletes from the map
// being walked.
function evictOtherBriefs(briefKey: string): void {
  const staleResults: string[] = [];
  for (const [key, entry] of settledResults) {
    if (entry.briefKey !== briefKey) staleResults.push(key);
  }
  for (const key of staleResults) settledResults.delete(key);

  const staleRecords: ChunkRequestRecord[] = [];
  for (const record of recordsByChunk.values()) {
    if (record.briefKey !== briefKey) staleRecords.push(record);
  }
  for (const record of staleRecords) releaseRecord(record, record.waiters);
}

function startRecord(
  worker: Worker,
  request: ChunkTokensRequest,
  chunkKey: string,
  grammar: GrammarName,
): ChunkTokensHandle {
  const requestId = nextRequestId;
  nextRequestId += 1;

  let settle: SettleChunkTokens = noSettle;
  const promise = new Promise<ChunkTokensResult>((resolve) => {
    settle = resolve;
  });
  const record: ChunkRequestRecord = {
    requestId,
    briefKey: request.briefKey,
    chunkKey,
    chunkId: request.chunkId,
    promise,
    settle,
    waiters: 1,
  };
  recordsByChunk.set(chunkKey, record);
  recordsByRequest.set(requestId, record);

  const message: TokenizeRequest = {
    kind: TokenMessageKinds.TOKENIZE,
    requestId,
    chunkId: request.chunkId,
    grammar,
    rows: request.rows.map(shapeTokenizableRow),
  };
  // A Worker's postMessage takes no target origin; the rule reads window's.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  worker.postMessage(message);

  return { promise, cancel: () => releaseRecord(record) };
}

function noSettle(): void {}

function releaseRecord(record: ChunkRequestRecord, released = 1): void {
  record.waiters -= released;
  if (record.waiters > 0) return;
  if (recordsByRequest.get(record.requestId) !== record) return;

  forgetRecord(record);
  record.settle(CANCELLED_RESULT);

  const message: CancelRequest = {
    kind: TokenMessageKinds.CANCEL,
    requestId: record.requestId,
  };
  // A Worker's postMessage takes no target origin; the rule reads window's.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  workerHandle?.postMessage(message);
}

function forgetRecord(record: ChunkRequestRecord): void {
  recordsByRequest.delete(record.requestId);
  if (recordsByChunk.get(record.chunkKey) === record) {
    recordsByChunk.delete(record.chunkKey);
  }
}

function startWorker(): Worker {
  const worker = new Worker(new URL("./worker", import.meta.url), {
    type: "module",
  });

  worker.addEventListener("message", (event: MessageEvent<unknown>) => {
    receiveReply(event.data);
  });
  worker.addEventListener("error", () => {
    retireWorker();
  });
  // A reply that fails to deserialize never reaches `message`, so without
  // this the records it would have settled wait for a reply that cannot come.
  worker.addEventListener("messageerror", () => {
    retireWorker();
  });

  return worker;
}

function receiveReply(data: unknown): void {
  const envelope = replyEnvelopeSchema.safeParse(data);
  if (!envelope.success) {
    console.error("diff token worker sent a message we cannot read");
    return;
  }

  const record = recordsByRequest.get(envelope.data.requestId);
  if (record === undefined) return;

  forgetRecord(record);
  const result = shapeResult(envelope.data, data);
  if (isWorthCaching(result)) {
    settledResults.set(record.chunkKey, {
      briefKey: record.briefKey,
      result,
    });
  }
  record.settle(result);
}

/**
 * A grammar load can fail from a dropped chunk fetch, so it is retried. Every
 * other failure is a property of the rows themselves and repeats, so caching
 * it spares the worker a request that would fail the same way.
 */
function isWorthCaching(result: ChunkTokensResult): boolean {
  if (result.status !== ChunkTokenStatuses.FAILED) return true;

  return result.reason !== TokenFailureReasons.GRAMMAR_LOAD;
}

// Colour already delivered stays on screen; only the worker and the replies
// it still owed are dropped.
function retireWorker(): void {
  workerFailed = true;
  workerHandle?.terminate();
  workerHandle = undefined;

  const owed = [...recordsByRequest.values()];
  recordsByRequest.clear();
  recordsByChunk.clear();

  for (const record of owed) {
    record.settle({
      status: ChunkTokenStatuses.FAILED,
      reason: TokenFailureReasons.WORKER_ERROR,
    });
  }
}

function shapeResult(
  envelope: ReplyEnvelope,
  data: unknown,
): ChunkTokensResult {
  if (envelope.kind === TokenMessageKinds.FAILED) {
    return { status: ChunkTokenStatuses.FAILED, reason: envelope.reason };
  }

  const entries = readRowTokenEntries(data);
  if (entries === undefined) {
    console.error("diff token worker sent tokens we cannot read");

    return {
      status: ChunkTokenStatuses.FAILED,
      reason: TokenFailureReasons.TOKENIZE,
    };
  }

  return {
    status: ChunkTokenStatuses.READY,
    tokensByRow: new Map(entries),
  };
}

// Shape check only. The full reply schema stays the contract the suite pins;
// walking every token here would cost the main thread more than the worker
// saved it.
function readRowTokenEntries(data: unknown): RowTokenEntry[] | undefined {
  if (typeof data !== "object" || data === null) return undefined;

  const entries: unknown = Object.getOwnPropertyDescriptor(
    data,
    "tokensByRow",
  )?.value;

  return isRowTokenEntries(entries) ? entries : undefined;
}

function isRowTokenEntries(value: unknown): value is RowTokenEntry[] {
  if (!Array.isArray(value)) return false;

  // Every pair's shape, not the first alone: one bad row otherwise caches as
  // READY and throws at paint. The tokens inside a pair stay untyped, which
  // is the cheap half of the guard.
  return value.every((entry) => isRowTokenEntry(entry));
}

function isRowTokenEntry(value: unknown): value is RowTokenEntry {
  return (
    Array.isArray(value) &&
    typeof value[0] === "number" &&
    Array.isArray(value[1])
  );
}

function shapeTokenizableRow(row: DiffLine): TokenizableRow {
  return { kind: row.kind, content: row.content };
}
