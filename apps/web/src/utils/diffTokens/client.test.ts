import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  getDiffTokenWorker,
  planBriefGrammars,
  requestChunkTokens,
  requestSnippetTokens,
  resetDiffTokenWorker,
  warmDiffTokenWorker,
} from "./client";
import { DiffLineKinds } from "types/diff-lines";
import {
  ChunkTokenStatuses,
  GrammarNames,
  TokenFailureReasons,
  TokenizeModes,
  TokenMessageKinds,
  type ChunkTokensRequest,
  type DiffLine,
  type GrammarName,
  type SnippetTokensRequest,
  type TokensReply,
} from "./types";

const TS_ROWS: DiffLine[] = [
  { kind: DiffLineKinds.HUNK, content: "@@ -1 +1 @@" },
  { kind: DiffLineKinds.ADD, content: "const a = 1;" },
];

class StubWorker {
  static latest: StubWorker | undefined;

  readonly sent: unknown[] = [];

  readonly listeners = new Map<string, (event: unknown) => void>();

  constructor() {
    StubWorker.latest = this;
  }

  addEventListener(type: string, handler: (event: unknown) => void): void {
    this.listeners.set(type, handler);
  }

  postMessage(message: unknown): void {
    this.sent.push(message);
  }

  terminate(): void {}
}

function readWorker(): StubWorker {
  const worker = StubWorker.latest;
  if (worker === undefined) {
    throw new Error("no worker was constructed");
  }

  return worker;
}

function readSentRequestId(index: number): number {
  const message = readWorker().sent[index];
  if (typeof message !== "object" || message === null) {
    throw new Error("no message was posted");
  }

  const { requestId } = Object(message) as { requestId?: unknown };
  if (typeof requestId !== "number") {
    throw new Error("no request id was sent");
  }

  return requestId;
}

function deliverReply(reply: unknown): void {
  readWorker().listeners.get("message")?.({ data: reply });
}

function makeAdmitted(...grammars: GrammarName[]): ReadonlySet<GrammarName> {
  return new Set(grammars);
}

function makeRequest(
  overrides: Partial<ChunkTokensRequest> = {},
): ChunkTokensRequest {
  return {
    briefKey: "brief-a",
    chunkId: "chunk-1",
    filePath: "src/a.ts",
    rows: TS_ROWS,
    admitted: makeAdmitted(GrammarNames.TYPESCRIPT),
    ...overrides,
  };
}

function makeSnippetRequest(
  overrides: Partial<SnippetTokensRequest> = {},
): SnippetTokensRequest {
  return {
    briefKey: "brief-a",
    snippetKey: "snippet-1",
    filePath: "src/a.ts",
    rows: TS_ROWS,
    admitted: makeAdmitted(GrammarNames.TYPESCRIPT),
    ...overrides,
  };
}

function readSentMessage(index: number): Record<string, unknown> {
  const message = readWorker().sent[index];
  if (typeof message !== "object" || message === null) {
    throw new Error("no message was posted");
  }

  return { ...message };
}

function makeTokensReply(requestId: number): TokensReply {
  return {
    kind: TokenMessageKinds.TOKENS,
    requestId,
    sourceId: "chunk-1",
    tokensByRow: [[1, [{ text: "const", classId: 4 }]]],
    tokenizeMs: 3,
  };
}

beforeEach(() => {
  StubWorker.latest = undefined;
  vi.stubGlobal("Worker", StubWorker);
});

afterEach(() => {
  resetDiffTokenWorker();
});

describe("warmDiffTokenWorker", () => {
  it("posts the brief's grammars before any chunk asks", () => {
    warmDiffTokenWorker("brief-a", [GrammarNames.TYPESCRIPT]);

    expect(readWorker().sent).toEqual([
      {
        kind: TokenMessageKinds.WARM,
        grammars: [GrammarNames.TYPESCRIPT],
      },
    ]);
  });
});

describe("requestChunkTokens", () => {
  it("resolves ready with the rows the worker coloured", async () => {
    const handle = requestChunkTokens(makeRequest());
    deliverReply(makeTokensReply(readSentRequestId(0)));

    await expect(handle.promise).resolves.toEqual({
      status: ChunkTokenStatuses.READY,
      tokensByRow: new Map([[1, [{ text: "const", classId: 4 }]]]),
    });
  });

  it("posts each row's file line numbers beside its kind and content", () => {
    void requestChunkTokens(
      makeRequest({
        rows: [
          { kind: DiffLineKinds.HUNK, content: "@@ -3 +4 @@" },
          { kind: DiffLineKinds.CTX, content: "a", oldLine: 3, newLine: 4 },
          { kind: DiffLineKinds.ADD, content: "b", newLine: 5 },
        ],
      }),
    );

    expect(readSentMessage(0)["rows"]).toEqual([
      { kind: "hunk", content: "@@ -3 +4 @@" },
      { kind: "ctx", content: "a", oldLine: 3, newLine: 4 },
      { kind: "add", content: "b", newLine: 5 },
    ]);
  });

  it("resolves failed with the reason the worker named", async () => {
    const handle = requestChunkTokens(makeRequest());
    deliverReply({
      kind: TokenMessageKinds.FAILED,
      requestId: readSentRequestId(0),
      sourceId: "chunk-1",
      reason: TokenFailureReasons.GRAMMAR_LOAD,
    });

    await expect(handle.promise).resolves.toEqual({
      status: ChunkTokenStatuses.FAILED,
      reason: TokenFailureReasons.GRAMMAR_LOAD,
    });
  });

  it("drops a reply whose request id nobody is waiting on", async () => {
    const handle = requestChunkTokens(makeRequest());
    deliverReply(makeTokensReply(readSentRequestId(0) + 99));
    deliverReply(makeTokensReply(readSentRequestId(0)));

    await expect(handle.promise).resolves.toMatchObject({
      status: ChunkTokenStatuses.READY,
    });
  });

  it("drops a malformed reply and says so once", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    void requestChunkTokens(makeRequest());
    deliverReply({ kind: "nonsense" });

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("refuses a tokens reply whose token array is the wrong shape", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const handle = requestChunkTokens(makeRequest());
    deliverReply({
      kind: TokenMessageKinds.TOKENS,
      requestId: readSentRequestId(0),
      sourceId: "chunk-1",
      tokensByRow: ["not a pair"],
      tokenizeMs: 3,
    });

    await expect(handle.promise).resolves.toEqual({
      status: ChunkTokenStatuses.FAILED,
      reason: TokenFailureReasons.TOKENIZE,
    });
  });

  it("fails every owed reply when the worker itself errors", async () => {
    const handle = requestChunkTokens(makeRequest());
    readWorker().listeners.get("error")?.({});

    await expect(handle.promise).resolves.toEqual({
      status: ChunkTokenStatuses.FAILED,
      reason: TokenFailureReasons.WORKER_ERROR,
    });
  });

  it("serves a second mount of one chunk from the cache", async () => {
    const first = requestChunkTokens(makeRequest());
    deliverReply(makeTokensReply(readSentRequestId(0)));
    await first.promise;

    const second = requestChunkTokens(makeRequest());

    await expect(second.promise).resolves.toMatchObject({
      status: ChunkTokenStatuses.READY,
    });
    expect(readWorker().sent).toHaveLength(1);
  });

  it("never serves an expanded chunk from the folded chunk's cache", async () => {
    const folded = requestChunkTokens(makeRequest());
    deliverReply(makeTokensReply(readSentRequestId(0)));
    await folded.promise;

    requestChunkTokens(makeRequest({ expansionKey: "3:down@2-21" }));

    expect(readWorker().sent).toHaveLength(2);
  });

  it("serves a second mount of one expanded chunk from the cache", async () => {
    const expansionKey = "3:down@2-21";
    const first = requestChunkTokens(makeRequest({ expansionKey }));
    deliverReply(makeTokensReply(readSentRequestId(0)));
    await first.promise;

    requestChunkTokens(makeRequest({ expansionKey }));

    expect(readWorker().sent).toHaveLength(1);
  });

  it("asks again for a chunk whose grammar failed to load", async () => {
    const first = requestChunkTokens(makeRequest());
    deliverReply({
      kind: TokenMessageKinds.FAILED,
      requestId: readSentRequestId(0),
      sourceId: "chunk-1",
      reason: TokenFailureReasons.GRAMMAR_LOAD,
    });
    await first.promise;

    void requestChunkTokens(makeRequest());

    expect(readWorker().sent).toHaveLength(2);
  });

  it("caches a chunk the tokenizer itself refused", async () => {
    const first = requestChunkTokens(makeRequest());
    deliverReply({
      kind: TokenMessageKinds.FAILED,
      requestId: readSentRequestId(0),
      sourceId: "chunk-1",
      reason: TokenFailureReasons.TOKENIZE,
    });
    await first.promise;

    void requestChunkTokens(makeRequest());

    expect(readWorker().sent).toHaveLength(1);
  });

  it("shares one message between two concurrent mounts of a chunk", async () => {
    const first = requestChunkTokens(makeRequest());
    const second = requestChunkTokens(makeRequest());

    expect(readWorker().sent).toHaveLength(1);
    deliverReply(makeTokensReply(readSentRequestId(0)));

    await expect(first.promise).resolves.toMatchObject({
      status: ChunkTokenStatuses.READY,
    });
    await expect(second.promise).resolves.toMatchObject({
      status: ChunkTokenStatuses.READY,
    });
  });

  it("keeps working when only one of two mounts lets go", async () => {
    const first = requestChunkTokens(makeRequest());
    const second = requestChunkTokens(makeRequest());
    first.cancel();
    deliverReply(makeTokensReply(readSentRequestId(0)));

    await expect(second.promise).resolves.toMatchObject({
      status: ChunkTokenStatuses.READY,
    });
  });

  it("tells the worker to stop once the last mount lets go", async () => {
    const handle = requestChunkTokens(makeRequest());
    handle.cancel();

    expect(readWorker().sent[1]).toEqual({
      kind: TokenMessageKinds.CANCEL,
      requestId: readSentRequestId(0),
    });
    await expect(handle.promise).resolves.toEqual({
      status: ChunkTokenStatuses.FAILED,
      reason: TokenFailureReasons.CANCELLED,
    });
  });

  it("asks again for a chunk whose earlier request was cancelled", () => {
    requestChunkTokens(makeRequest()).cancel();
    void requestChunkTokens(makeRequest());

    expect(readWorker().sent).toHaveLength(3);
  });

  it("never serves one brief's chunk id from another brief's cache", async () => {
    const first = requestChunkTokens(makeRequest());
    deliverReply(makeTokensReply(readSentRequestId(0)));
    await first.promise;

    void requestChunkTokens(makeRequest({ briefKey: "brief-b" }));

    expect(readWorker().sent).toHaveLength(2);
  });

  it("never joins a request for one brief onto another brief's", () => {
    void requestChunkTokens(makeRequest());
    void requestChunkTokens(makeRequest({ briefKey: "brief-b" }));

    expect(readWorker().sent).toHaveLength(2);
  });

  it("renders plain for every chunk once the worker has errored", async () => {
    const handle = requestChunkTokens(makeRequest());
    readWorker().listeners.get("error")?.({});
    await handle.promise;

    const later = requestChunkTokens(makeRequest({ chunkId: "chunk-2" }));

    await expect(later.promise).resolves.toEqual({
      status: ChunkTokenStatuses.PLAIN,
    });
    expect(readWorker().sent).toHaveLength(1);
    expect(getDiffTokenWorker()).toBeUndefined();
  });

  it("renders plain for a file with no grammar of ours", async () => {
    await expect(
      requestChunkTokens(makeRequest({ filePath: "docs/logo.png" })).promise,
    ).resolves.toEqual({ status: ChunkTokenStatuses.PLAIN });
    expect(StubWorker.latest).toBeUndefined();
  });

  it("renders plain for a chunk over the row ceiling", async () => {
    const rows: DiffLine[] = Array.from({ length: 1001 }, () => ({
      kind: DiffLineKinds.CTX,
      content: "x",
    }));

    await expect(
      requestChunkTokens(makeRequest({ rows })).promise,
    ).resolves.toEqual({ status: ChunkTokenStatuses.PLAIN });
  });

  it("renders plain for a grammar the budget did not admit", async () => {
    await expect(
      requestChunkTokens(
        makeRequest({ admitted: makeAdmitted(GrammarNames.SCSS) }),
      ).promise,
    ).resolves.toEqual({ status: ChunkTokenStatuses.PLAIN });
  });

  it("renders plain where the runtime has no Worker", async () => {
    vi.stubGlobal("Worker", undefined);

    await expect(requestChunkTokens(makeRequest()).promise).resolves.toEqual({
      status: ChunkTokenStatuses.PLAIN,
    });
  });
});

describe("warmDiffTokenWorker across briefs", () => {
  it("drops the cache of the brief the reader left", async () => {
    const first = requestChunkTokens(makeRequest());
    deliverReply(makeTokensReply(readSentRequestId(0)));
    await first.promise;

    warmDiffTokenWorker("brief-b", [GrammarNames.TYPESCRIPT]);
    void requestChunkTokens(makeRequest());

    expect(readWorker().sent).toHaveLength(3);
  });

  it("cancels work still owed for the brief the reader left", async () => {
    const handle = requestChunkTokens(makeRequest());

    warmDiffTokenWorker("brief-b", [GrammarNames.TYPESCRIPT]);

    await expect(handle.promise).resolves.toEqual({
      status: ChunkTokenStatuses.FAILED,
      reason: TokenFailureReasons.CANCELLED,
    });
  });

  it("keeps the current brief's cache when it warms again", async () => {
    warmDiffTokenWorker("brief-a", [GrammarNames.TYPESCRIPT]);
    const first = requestChunkTokens(makeRequest());
    deliverReply(makeTokensReply(readSentRequestId(1)));
    await first.promise;

    warmDiffTokenWorker("brief-a", [GrammarNames.TYPESCRIPT]);
    const second = requestChunkTokens(makeRequest());

    await expect(second.promise).resolves.toMatchObject({
      status: ChunkTokenStatuses.READY,
    });
  });
});

describe("planBriefGrammars", () => {
  it("admits the grammars a brief's own files need", () => {
    const plan = planBriefGrammars([
      { file: "src/a.ts", rowCount: 40 },
      { file: "src/b.scss", rowCount: 10 },
    ]);

    expect(plan.admitted).toEqual([GrammarNames.TYPESCRIPT, GrammarNames.SCSS]);
  });

  it("skips a file no grammar of ours claims", () => {
    const plan = planBriefGrammars([{ file: "docs/logo.png", rowCount: 40 }]);

    expect(plan.admitted).toEqual([]);
  });

  it("skips a file over the row ceiling", () => {
    const plan = planBriefGrammars([{ file: "src/a.ts", rowCount: 5000 }]);

    expect(plan.admitted).toEqual([]);
  });
});

describe("requestSnippetTokens", () => {
  it("asks the worker to tokenize standalone", () => {
    void requestSnippetTokens(makeSnippetRequest());

    expect(readSentMessage(0)["mode"]).toBe(TokenizeModes.STANDALONE);
    expect(readSentMessage(0)["sourceId"]).toBe("snippet-1");
  });

  it("tokenizes as a hunk when the caller names that mode", () => {
    void requestSnippetTokens(makeSnippetRequest({ mode: TokenizeModes.HUNK }));

    expect(readSentMessage(0)["mode"]).toBe(TokenizeModes.HUNK);
  });

  it("renders plain for a language the brief did not admit", async () => {
    const handle = requestSnippetTokens(
      makeSnippetRequest({ admitted: makeAdmitted() }),
    );

    await expect(handle.promise).resolves.toEqual({
      status: ChunkTokenStatuses.PLAIN,
    });
  });

  it("never serves a chunk reply to a snippet of the same id", async () => {
    const chunk = requestChunkTokens(makeRequest({ chunkId: "same" }));
    deliverReply(makeTokensReply(readSentRequestId(0)));
    await chunk.promise;

    void requestSnippetTokens(makeSnippetRequest({ snippetKey: "same" }));

    expect(readWorker().sent).toHaveLength(2);
  });
});
