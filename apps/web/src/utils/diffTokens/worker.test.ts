import { afterEach, describe, expect, it, vi } from "vitest";

import { workerReplySchema } from "./schemas";
import { DiffLineKinds } from "types/diff-lines";
import {
  GrammarNames,
  TokenizeModes,
  TokenMessageKinds,
  type GrammarName,
  type TokenizableRow,
  type TokensReply,
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

// A cold grammar import outlasts vi.waitFor's 1 s default: C++ pulls in five
// modules. Kept under vite.config.ts's 20 s testTimeout so a hang fails here.
const COLD_GRAMMAR_WAIT_MS = 10_000;

const GRAMMAR_SAMPLES: [GrammarName, string][] = [
  [GrammarNames.C, 'int main(void) { return printf("hi"); }'],
  [GrammarNames.CPP, "template <typename T> class Box { T value; };"],
  [GrammarNames.CSHARP, 'public class A { string b = "hi"; }'],
  [GrammarNames.GO, 'func main() { fmt.Println("hi") }'],
  [GrammarNames.JAVA, 'public class A { String b = "hi"; }'],
  [GrammarNames.KOTLIN, 'fun main() { val a = "hi" }'],
  [GrammarNames.PHP, 'function a($b) { return "hi" . $b; }'],
  [GrammarNames.RUST, "fn main() { let a: u32 = 42; }"],
  [GrammarNames.SWIFT, 'func a(b: Int) -> String { return "hi" }'],
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

type TokensByRow = TokensReply["tokensByRow"];

function readTokensByRow(requestId: number): TokensByRow {
  const replies = sent.map((message) => workerReplySchema.parse(message));
  const reply = replies.find((candidate) => candidate.requestId === requestId);
  if (reply?.kind !== TokenMessageKinds.TOKENS) {
    throw new Error(`no tokens reply for request ${String(requestId)}`);
  }

  return reply.tokensByRow;
}

function readRowTokens(tokensByRow: TokensByRow, row: number): unknown {
  return tokensByRow.find(([index]) => index === row)?.[1];
}

afterEach(() => {
  vi.unstubAllGlobals();
  scope = undefined;
});

describe("diff token worker", () => {
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
    if (reply.kind !== TokenMessageKinds.TOKENS) {
      return;
    }
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

  it("stays silent on an unreadable warm that names an id", async () => {
    await startWorkerModule();
    sendToWorker({ kind: "warm", requestId: 8, sourceId: "c8" });
    await Promise.resolve();

    expect(sent).toEqual([]);
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

  it("serves the next request after a cancel that came too late", async () => {
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
    const rows: TokenizableRow[] = [
      { kind: DiffLineKinds.DEL, content: "const label = `" },
      { kind: DiffLineKinds.ADD, content: "total + 1;" },
    ];
    const request = {
      kind: TokenMessageKinds.TOKENIZE,
      sourceId: "snippet-1",
      grammar: GrammarNames.TSX,
      rows,
    };
    sendToWorker({ ...request, requestId: 11, mode: TokenizeModes.STANDALONE });
    sendToWorker({ ...request, requestId: 12, mode: TokenizeModes.HUNK });

    await vi.waitFor(() => {
      expect(sent).toHaveLength(2);
    });
    const standalone = readTokensByRow(11);

    expect(standalone.map(([row]) => row).toSorted((a, b) => a - b)).toEqual([
      0, 1,
    ]);
    expect(readRowTokens(standalone, 1)).not.toEqual(
      readRowTokens(readTokensByRow(12), 1),
    );
  });
});

describe("diff token worker grammar loaders", () => {
  it.each(GRAMMAR_SAMPLES)(
    "colours a %s row through its grammar loader",
    async (grammar, content) => {
      await startWorkerModule();
      sendToWorker({
        kind: TokenMessageKinds.TOKENIZE,
        requestId: 1,
        sourceId: "chunk-1",
        grammar,
        mode: TokenizeModes.HUNK,
        rows: [
          { kind: DiffLineKinds.HUNK, content: "@@ -0,0 +1 @@" },
          { kind: DiffLineKinds.ADD, content, newLine: 1 },
        ],
      });

      await vi.waitFor(
        () => {
          expect(sent).toHaveLength(1);
        },
        { timeout: COLD_GRAMMAR_WAIT_MS },
      );
      const row = readTokensByRow(1).find(([index]) => index === 1)?.[1] ?? [];
      const classIds = new Set(row.map((token) => token.classId));

      expect(classIds.size).toBeGreaterThan(1);
    },
  );
});
