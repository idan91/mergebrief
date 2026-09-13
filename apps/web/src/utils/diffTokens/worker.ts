/// <reference lib="webworker" />
import {
  createHighlighterCore,
  type HighlighterCore,
  type LanguageRegistration,
} from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

import { unreadableRequestSchema, workerRequestSchema } from "./schemas";
import { MERGEBRIEF_DARK } from "./theme";
import { tokenizeChunkRows } from "./tokenizeChunk";
import {
  GrammarNames,
  TokenFailureReasons,
  TokenMessageKinds,
  type GrammarName,
  type TokenFailureReason,
  type TokenizeRequest,
  type WarmRequest,
  type WorkerReply,
} from "./types";

declare const self: DedicatedWorkerGlobalScope;

interface GrammarModule {
  default: LanguageRegistration[];
}

type GrammarLoader = () => Promise<GrammarModule>;

/**
 * One dynamic import per grammar, so the bundler emits one chunk per language
 * and a TypeScript pull request downloads TypeScript alone.
 */
const GRAMMAR_LOADERS: Record<GrammarName, GrammarLoader> = {
  [GrammarNames.ASTRO]: () => import("shiki/langs/astro.mjs"),
  [GrammarNames.CSS]: () => import("shiki/langs/css.mjs"),
  [GrammarNames.DIFF]: () => import("shiki/langs/diff.mjs"),
  [GrammarNames.DOCKER]: () => import("shiki/langs/docker.mjs"),
  [GrammarNames.DOTENV]: () => import("shiki/langs/dotenv.mjs"),
  [GrammarNames.GRAPHQL]: () => import("shiki/langs/graphql.mjs"),
  [GrammarNames.HTML]: () => import("shiki/langs/html.mjs"),
  [GrammarNames.INI]: () => import("shiki/langs/ini.mjs"),
  [GrammarNames.JAVASCRIPT]: () => import("shiki/langs/javascript.mjs"),
  [GrammarNames.JSON]: () => import("shiki/langs/json.mjs"),
  [GrammarNames.JSONC]: () => import("shiki/langs/jsonc.mjs"),
  [GrammarNames.JSX]: () => import("shiki/langs/jsx.mjs"),
  [GrammarNames.MAKE]: () => import("shiki/langs/make.mjs"),
  [GrammarNames.MARKDOWN]: () => import("shiki/langs/markdown.mjs"),
  [GrammarNames.MDX]: () => import("shiki/langs/mdx.mjs"),
  [GrammarNames.PYTHON]: () => import("shiki/langs/python.mjs"),
  [GrammarNames.SCSS]: () => import("shiki/langs/scss.mjs"),
  [GrammarNames.SHELLSCRIPT]: () => import("shiki/langs/shellscript.mjs"),
  [GrammarNames.SQL]: () => import("shiki/langs/sql.mjs"),
  [GrammarNames.TOML]: () => import("shiki/langs/toml.mjs"),
  [GrammarNames.TSX]: () => import("shiki/langs/tsx.mjs"),
  [GrammarNames.TYPESCRIPT]: () => import("shiki/langs/typescript.mjs"),
  [GrammarNames.VUE]: () => import("shiki/langs/vue.mjs"),
  [GrammarNames.XML]: () => import("shiki/langs/xml.mjs"),
  [GrammarNames.YAML]: () => import("shiki/langs/yaml.mjs"),
};

let highlighterPromise: Promise<HighlighterCore> | undefined;
const grammarLoads = new Map<GrammarName, Promise<void>>();
const cancelledRequests = new Set<number>();
const inFlightRequests = new Set<number>();

self.addEventListener("message", (event: MessageEvent<unknown>) => {
  void receiveMessage(event.data);
});

async function receiveMessage(data: unknown): Promise<void> {
  const parsed = workerRequestSchema.safeParse(data);
  if (!parsed.success) {
    replyToUnreadable(data);
    return;
  }

  if (parsed.data.kind === TokenMessageKinds.WARM) {
    await warmGrammars(parsed.data);
    return;
  }

  if (parsed.data.kind === TokenMessageKinds.CANCEL) {
    cancelledRequests.add(parsed.data.requestId);
    return;
  }

  const reply = await shapeTokenizeReply(parsed.data);
  if (reply === undefined) return;

  // A worker scope's postMessage takes no target origin; the rule reads window's.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  self.postMessage(reply);
}

/**
 * `undefined` where the reader has already scrolled past this chunk. The
 * queue is FIFO and tokenizing is synchronous, so without the yield below a
 * cancel posted during a long chunk could not be read until after the next
 * one had already been tokenized.
 */
async function shapeTokenizeReply(
  request: TokenizeRequest,
): Promise<WorkerReply | undefined> {
  inFlightRequests.add(request.requestId);

  try {
    return await runTokenize(request);
  } finally {
    inFlightRequests.delete(request.requestId);
    pruneCancelledBelow(readPruneFloor(request.requestId));
  }
}

async function runTokenize(
  request: TokenizeRequest,
): Promise<WorkerReply | undefined> {
  await drainMessageQueue();
  if (readCancelled(request.requestId)) return undefined;

  const highlighter = await loadHighlighterForGrammar(request.grammar);
  if (highlighter === undefined) {
    return shapeFailure(request, TokenFailureReasons.GRAMMAR_LOAD);
  }

  if (readCancelled(request.requestId)) return undefined;

  try {
    const startedAt = performance.now();
    const byRow = tokenizeChunkRows(highlighter, request.rows, request.grammar);
    const tokenizeMs = performance.now() - startedAt;

    return {
      kind: TokenMessageKinds.TOKENS,
      requestId: request.requestId,
      chunkId: request.chunkId,
      tokensByRow: [...byRow.entries()],
      tokenizeMs,
    };
  } catch {
    return shapeFailure(request, TokenFailureReasons.TOKENIZE);
  }
}

function shapeFailure(
  request: TokenizeRequest,
  reason: TokenFailureReason,
): WorkerReply {
  return {
    kind: TokenMessageKinds.FAILED,
    requestId: request.requestId,
    chunkId: request.chunkId,
    reason,
  };
}

async function warmGrammars(request: WarmRequest): Promise<void> {
  const highlighter = await loadHighlighter().catch(() => undefined);
  if (highlighter === undefined) return;

  await Promise.allSettled(
    request.grammars.map((grammar) => loadGrammar(highlighter, grammar)),
  );
}

async function loadHighlighterForGrammar(
  grammar: GrammarName,
): Promise<HighlighterCore | undefined> {
  try {
    const highlighter = await loadHighlighter();
    await loadGrammar(highlighter, grammar);

    return highlighter;
  } catch {
    return undefined;
  }
}

function readCancelled(requestId: number): boolean {
  return cancelledRequests.delete(requestId);
}

// Request ids are monotonic on the client, so a cancel below every id still
// running can never be claimed. Without this the set keeps every cancel that
// landed after its own reply had already gone out.
function pruneCancelledBelow(floor: number): void {
  for (const cancelled of cancelledRequests) {
    if (cancelled < floor) cancelledRequests.delete(cancelled);
  }
}

function readPruneFloor(requestId: number): number {
  let lowest: number | undefined;

  for (const inFlight of inFlightRequests) {
    if (lowest === undefined || inFlight < lowest) lowest = inFlight;
  }

  return lowest ?? requestId + 1;
}

function drainMessageQueue(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function loadHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= createHighlighterCore({
    themes: [MERGEBRIEF_DARK],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  }).catch((reason: unknown) => {
    highlighterPromise = undefined;
    throw reason;
  });

  return highlighterPromise;
}

// A request this build cannot read still names a request id when the client
// is newer than the cached worker; answering keeps that chunk from pending
// forever.
function replyToUnreadable(data: unknown): void {
  const parsed = unreadableRequestSchema.safeParse(data);
  if (!parsed.success) return;

  const reply: WorkerReply = {
    kind: TokenMessageKinds.FAILED,
    requestId: parsed.data.requestId,
    chunkId: parsed.data.chunkId,
    reason: TokenFailureReasons.TOKENIZE,
  };
  // A worker scope's postMessage takes no target origin; the rule reads window's.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  self.postMessage(reply);
}

// A settled load is a no-op on every later request; a rejected one is
// forgotten so a transient chunk fetch failure can be retried.
function loadGrammar(
  highlighter: HighlighterCore,
  grammar: GrammarName,
): Promise<void> {
  const inFlight = grammarLoads.get(grammar);
  if (inFlight !== undefined) return inFlight;

  const started = GRAMMAR_LOADERS[grammar]()
    .then(async (module) => {
      await highlighter.loadLanguage(module.default);

      return undefined;
    })
    .catch((reason: unknown) => {
      grammarLoads.delete(grammar);
      throw reason;
    });
  grammarLoads.set(grammar, started);

  return started;
}
