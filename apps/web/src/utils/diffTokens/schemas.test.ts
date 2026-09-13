import { describe, expect, it } from "vitest";

import {
  replyEnvelopeSchema,
  workerReplySchema,
  workerRequestSchema,
} from "./schemas";
import {
  DiffLineKinds,
  GrammarNames,
  TokenFailureReasons,
  type TokenizeRequest,
  TokenMessageKinds,
  type TokensReply,
  type WarmRequest,
} from "./types";

const TOKENIZE_REQUEST: TokenizeRequest = {
  kind: TokenMessageKinds.TOKENIZE,
  requestId: 3,
  chunkId: "chunk-1",
  grammar: GrammarNames.TYPESCRIPT,
  rows: [
    { kind: DiffLineKinds.HUNK, content: "@@ -1 +1 @@" },
    { kind: DiffLineKinds.ADD, content: "const a = 1;" },
  ],
};

const WARM_REQUEST: WarmRequest = {
  kind: TokenMessageKinds.WARM,
  grammars: [GrammarNames.TSX, GrammarNames.SCSS],
};

const TOKENS_REPLY: TokensReply = {
  kind: TokenMessageKinds.TOKENS,
  requestId: 3,
  chunkId: "chunk-1",
  tokensByRow: [[1, [{ text: "const", classId: 4 }]]],
  tokenizeMs: 3,
};

describe("workerRequestSchema", () => {
  it("round-trips a tokenize request", () => {
    expect(workerRequestSchema.parse(TOKENIZE_REQUEST)).toEqual(
      TOKENIZE_REQUEST,
    );
  });

  it("round-trips a warm request", () => {
    expect(workerRequestSchema.parse(WARM_REQUEST)).toEqual(WARM_REQUEST);
  });

  it("round-trips a cancel request", () => {
    const request = { kind: TokenMessageKinds.CANCEL, requestId: 3 };

    expect(workerRequestSchema.parse(request)).toEqual(request);
  });

  it("rejects a request whose kind nothing serves", () => {
    const parsed = workerRequestSchema.safeParse({ kind: "shade" });

    expect(parsed.success).toBe(false);
  });

  it("rejects a row kind outside the diff vocabulary", () => {
    const parsed = workerRequestSchema.safeParse({
      ...TOKENIZE_REQUEST,
      rows: [{ kind: "expanded", content: "x" }],
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a grammar we ship no loader for", () => {
    const parsed = workerRequestSchema.safeParse({
      ...TOKENIZE_REQUEST,
      grammar: "cobol",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a negative request id", () => {
    const parsed = workerRequestSchema.safeParse({
      ...TOKENIZE_REQUEST,
      requestId: -1,
    });

    expect(parsed.success).toBe(false);
  });
});

describe("replyEnvelopeSchema", () => {
  it("reads the routing fields of a tokens reply", () => {
    expect(replyEnvelopeSchema.parse(TOKENS_REPLY)).toEqual({
      kind: TokenMessageKinds.TOKENS,
      requestId: 3,
      chunkId: "chunk-1",
      tokenizeMs: 3,
    });
  });

  it("accepts a tokens reply it never walks the tokens of", () => {
    const parsed = replyEnvelopeSchema.safeParse({
      ...TOKENS_REPLY,
      tokensByRow: "not an array at all",
    });

    expect(parsed.success).toBe(true);
  });

  it("rejects a reply whose kind nothing serves", () => {
    expect(replyEnvelopeSchema.safeParse({ kind: "shade" }).success).toBe(
      false,
    );
  });
});

describe("workerReplySchema", () => {
  it("round-trips a tokens reply", () => {
    expect(workerReplySchema.parse(TOKENS_REPLY)).toEqual(TOKENS_REPLY);
  });

  it("round-trips a failed reply", () => {
    const reply = {
      kind: TokenMessageKinds.FAILED,
      requestId: 3,
      chunkId: "chunk-1",
      reason: TokenFailureReasons.TOKENIZE,
    };

    expect(workerReplySchema.parse(reply)).toEqual(reply);
  });

  it("rejects a failure reason outside the closed set", () => {
    const parsed = workerReplySchema.safeParse({
      kind: TokenMessageKinds.FAILED,
      requestId: 3,
      chunkId: "chunk-1",
      reason: "it exploded",
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a token row entry that is not a pair", () => {
    const parsed = workerReplySchema.safeParse({
      ...TOKENS_REPLY,
      tokensByRow: [[1]],
      tokenizeMs: 3,
    });

    expect(parsed.success).toBe(false);
  });

  it("rejects a reply with no request id", () => {
    const parsed = workerReplySchema.safeParse({
      kind: TokenMessageKinds.TOKENS,
      chunkId: "chunk-1",
      tokensByRow: [],
      tokenizeMs: 3,
    });

    expect(parsed.success).toBe(false);
  });
});
