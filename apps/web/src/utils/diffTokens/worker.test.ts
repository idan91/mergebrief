import { afterEach, describe, expect, it, vi } from "vitest";

import { workerReplySchema } from "./schemas";
import {
  DiffLineKinds,
  GrammarNames,
  TokenizeModes,
  TokenMessageKinds,
  type TokenizableRow,
} from "./types";

interface WorkerScope {
  listeners: Map<string, (event: unknown) => void>;
  addEventListener: (type: string, handler: (event: unknown) => void) => void;
  postMessage: (message: unknown) => void;
}

const TSX_ROWS: TokenizableRow[] = [
  { kind: DiffLineKinds.HUNK, content: "@@ -1,2 +1,2 @@" },
  { kind: DiffLineKinds.ADD, content: "const a = 1;" },
  { kind: DiffLineKinds.CTX, content: "const b = 2;" },
];

let sent: unknown[] = [];
let scope: WorkerScope | undefined;

async function startWorkerModule(): Promise<void> {
  sent = [];
  const listeners = new Map<string, (event: unknown) => void>();
  scope = {
    listeners,
    addEventListener: (type, handler) => {
      listeners.set(type, handler);
    },
    postMessage: (message: unknown) => {
      sent.push(message);
    },
  };
  vi.stubGlobal("self", scope);
  vi.resetModules();
  await import("./worker");
}

function sendToWorker(message: unknown): void {
  scope?.listeners.get("message")?.({ data: message });
}

async function readOneReply(): Promise<unknown> {
  await vi.waitFor(() => {
    expect(sent).toHaveLength(1);
  });

  return sent[0];
}

afterEach(() => {
  vi.unstubAllGlobals();
  scope = undefined;
});

describe("diff token worker", () => {
  it("listens as soon as it loads", async () => {
    await startWorkerModule();

    expect(scope?.listeners.get("message")).toBeTypeOf("function");
  });

  it("replies with tokens keyed by diff row", async () => {
    await startWorkerModule();
    sendToWorker({
      kind: TokenMessageKinds.TOKENIZE,
      requestId: 7,
      sourceId: "chunk-1",
      grammar: GrammarNames.TSX,
      mode: TokenizeModes.HUNK,
      rows: TSX_ROWS,
    });

    const reply = workerReplySchema.parse(await readOneReply());

    expect(reply.kind).toBe(TokenMessageKinds.TOKENS);
    expect(reply.requestId).toBe(7);
    if (reply.kind !== TokenMessageKinds.TOKENS) return;
    expect(
      reply.tokensByRow.map(([row]) => row).toSorted((a, b) => a - b),
    ).toEqual([1, 2]);
  });

  it("stays silent on a message it cannot read", async () => {
    await startWorkerModule();
    sendToWorker({ kind: "shade" });
    await Promise.resolve();

    expect(sent).toEqual([]);
  });

  it("fails a request it cannot read that still names its id", async () => {
    await startWorkerModule();
    sendToWorker({ kind: "tokenize", requestId: 7, sourceId: "c7" });
    await Promise.resolve();

    expect(sent).toEqual([
      { kind: "failed", requestId: 7, sourceId: "c7", reason: "tokenize" },
    ]);
  });

  it("stays silent on an unreadable cancel that names an id", async () => {
    await startWorkerModule();
    sendToWorker({ kind: "cancel", requestId: 7, sourceId: "c7", extra: 1 });
    sendToWorker({ kind: "warm", requestId: 8, sourceId: "c8" });
    await Promise.resolve();

    expect(sent).toEqual([]);
  });

  it("stays silent on a warm request", async () => {
    await startWorkerModule();
    sendToWorker({
      kind: TokenMessageKinds.WARM,
      grammars: [GrammarNames.TYPESCRIPT],
    });
    await Promise.resolve();

    expect(sent).toEqual([]);
  });

  it("stays silent on a chunk the reader scrolled past", async () => {
    await startWorkerModule();
    sendToWorker({
      kind: TokenMessageKinds.TOKENIZE,
      requestId: 4,
      sourceId: "chunk-1",
      grammar: GrammarNames.TYPESCRIPT,
      mode: TokenizeModes.HUNK,
      rows: TSX_ROWS,
    });
    sendToWorker({ kind: TokenMessageKinds.CANCEL, requestId: 4 });

    await vi.waitFor(() => {
      expect(sent).toEqual([]);
    });
  });

  it("still serves a later request for a chunk it cancelled", async () => {
    await startWorkerModule();
    sendToWorker({
      kind: TokenMessageKinds.TOKENIZE,
      requestId: 4,
      sourceId: "chunk-1",
      grammar: GrammarNames.TYPESCRIPT,
      mode: TokenizeModes.HUNK,
      rows: TSX_ROWS,
    });
    sendToWorker({ kind: TokenMessageKinds.CANCEL, requestId: 4 });
    sendToWorker({
      kind: TokenMessageKinds.TOKENIZE,
      requestId: 5,
      sourceId: "chunk-1",
      grammar: GrammarNames.TYPESCRIPT,
      mode: TokenizeModes.HUNK,
      rows: TSX_ROWS,
    });

    const reply = workerReplySchema.parse(await readOneReply());

    expect(reply.requestId).toBe(5);
  });

  it("forgets a cancel that landed after its reply had gone out", async () => {
    await startWorkerModule();
    sendToWorker({
      kind: TokenMessageKinds.TOKENIZE,
      requestId: 1,
      sourceId: "chunk-1",
      grammar: GrammarNames.TYPESCRIPT,
      mode: TokenizeModes.HUNK,
      rows: TSX_ROWS,
    });
    await readOneReply();
    sendToWorker({ kind: TokenMessageKinds.CANCEL, requestId: 1 });
    sendToWorker({
      kind: TokenMessageKinds.TOKENIZE,
      requestId: 2,
      sourceId: "chunk-2",
      grammar: GrammarNames.TYPESCRIPT,
      mode: TokenizeModes.HUNK,
      rows: TSX_ROWS,
    });

    await vi.waitFor(() => {
      expect(sent).toHaveLength(2);
    });
  });

  it("serves a chunk on a grammar a warm request already loaded", async () => {
    await startWorkerModule();
    sendToWorker({
      kind: TokenMessageKinds.WARM,
      grammars: [GrammarNames.TYPESCRIPT],
    });
    sendToWorker({
      kind: TokenMessageKinds.TOKENIZE,
      requestId: 1,
      sourceId: "chunk-1",
      grammar: GrammarNames.TYPESCRIPT,
      mode: TokenizeModes.HUNK,
      rows: TSX_ROWS,
    });

    const reply = workerReplySchema.parse(await readOneReply());

    expect(reply.kind).toBe(TokenMessageKinds.TOKENS);
  });

  it("tokenizes a standalone snippet in row order", async () => {
    await startWorkerModule();
    sendToWorker({
      kind: TokenMessageKinds.TOKENIZE,
      requestId: 11,
      sourceId: "snippet-1",
      grammar: GrammarNames.TSX,
      mode: TokenizeModes.STANDALONE,
      rows: [
        { kind: DiffLineKinds.ADD, content: "const a = 1;" },
        { kind: DiffLineKinds.ADD, content: "const b = 2;" },
      ],
    });

    const reply = workerReplySchema.parse(await readOneReply());

    expect(reply.kind).toBe(TokenMessageKinds.TOKENS);
    if (reply.kind !== TokenMessageKinds.TOKENS) return;
    expect(
      reply.tokensByRow.map(([row]) => row).toSorted((a, b) => a - b),
    ).toEqual([0, 1]);
  });
});
