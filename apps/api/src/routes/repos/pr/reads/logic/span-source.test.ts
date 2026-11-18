import { describe, expect, it } from "vitest";
import { BlobReadKinds, PrSpanFailureKinds } from "brief-core/pr-span";
import {
  GitHubApiErrorCodes,
  RepoFileKinds,
  type GitHubCallFailure,
} from "github";
import { buildApiPrSpanSource, type SpanReader } from "./span-source";

const SPAN = { base: "a".repeat(40), head: "b".repeat(40) };
const BLOB = { path: "src/a.ts", ref: "b".repeat(40), maxBytes: 1024 };
const DEADLINE_MS = 25_000;

function makeFailure(
  code: GitHubCallFailure["code"],
  status?: number,
): GitHubCallFailure {
  const failure: {
    code: GitHubCallFailure["code"];
    message: string;
    status?: number;
  } = { code, message: "refused" };
  if (status !== undefined) {
    failure.status = status;
  }
  return failure as GitHubCallFailure;
}

function stubReader(overrides: Partial<SpanReader> = {}): SpanReader {
  return {
    fetchCheckedCompareDiff: async () => ({ ok: true, value: "diff" }),
    fetchMergeBase: async () => ({ ok: true, value: "m".repeat(40) }),
    fetchRepoFile: async () => ({
      ok: true,
      value: { kind: RepoFileKinds.ABSENT },
    }),
    ...overrides,
  };
}

function openSignal(): AbortSignal {
  return new AbortController().signal;
}

describe("buildApiPrSpanSource", () => {
  it("reads a revoked installation as unavailable and keeps the failure", async () => {
    const revoked = makeFailure(GitHubApiErrorCodes.UNAUTHORIZED, 401);
    const reader = stubReader({
      fetchCheckedCompareDiff: async () => ({ ok: false, error: revoked }),
    });
    const span = buildApiPrSpanSource(reader, Date.now() + DEADLINE_MS);

    const read = await span.source.fetchPrDiff(SPAN, openSignal());

    expect(read).toEqual({
      ok: false,
      error: { kind: PrSpanFailureKinds.UNAVAILABLE },
    });
    expect(span.readFailure(PrSpanFailureKinds.UNAVAILABLE)).toBe(revoked);
  });

  it("keeps a revoked token over a missing ref when both read unavailable", async () => {
    const missing = makeFailure(GitHubApiErrorCodes.NOT_FOUND, 404);
    const revoked = makeFailure(GitHubApiErrorCodes.UNAUTHORIZED, 401);
    const reader = stubReader({
      fetchMergeBase: async () => ({ ok: false, error: missing }),
      fetchCheckedCompareDiff: async () => ({ ok: false, error: revoked }),
    });
    const span = buildApiPrSpanSource(reader, Date.now() + DEADLINE_MS);

    await span.source.fetchMergeBase(SPAN, openSignal());
    await span.source.fetchPrDiff(SPAN, openSignal());
    await span.source.fetchMergeBase(SPAN, openSignal());

    expect(span.readFailure(PrSpanFailureKinds.UNAVAILABLE)).toBe(revoked);
  });

  it("reads a 406 on a blob as too large", async () => {
    const reader = stubReader({
      fetchRepoFile: async () => ({
        ok: false,
        error: makeFailure(GitHubApiErrorCodes.REQUEST_FAILED, 406),
      }),
    });
    const span = buildApiPrSpanSource(reader, Date.now() + DEADLINE_MS);

    const read = await span.source.fetchBlob(BLOB, openSignal());

    expect(read).toEqual({
      ok: false,
      error: { kind: PrSpanFailureKinds.TOO_LARGE },
    });
  });

  it("reads a previous head GitHub no longer has as unavailable", async () => {
    const reader = stubReader({
      fetchMergeBase: async () => ({
        ok: false,
        error: makeFailure(GitHubApiErrorCodes.NOT_FOUND, 404),
      }),
    });
    const span = buildApiPrSpanSource(reader, Date.now() + DEADLINE_MS);

    const read = await span.source.fetchMergeBase(SPAN, openSignal());

    expect(read).toMatchObject({
      error: { kind: PrSpanFailureKinds.UNAVAILABLE },
    });
  });

  it("reads a server error as transient", async () => {
    const reader = stubReader({
      fetchMergeBase: async () => ({
        ok: false,
        error: makeFailure(GitHubApiErrorCodes.REQUEST_FAILED, 502),
      }),
    });
    const span = buildApiPrSpanSource(reader, Date.now() + DEADLINE_MS);

    const read = await span.source.fetchMergeBase(SPAN, openSignal());

    expect(read).toMatchObject({
      error: { kind: PrSpanFailureKinds.TRANSIENT },
    });
  });

  it("reads bytes GitHub will not serve as text as an unreadable blob", async () => {
    const reader = stubReader({
      fetchRepoFile: async () => ({
        ok: false,
        error: makeFailure(GitHubApiErrorCodes.NOT_TEXT),
      }),
    });
    const span = buildApiPrSpanSource(reader, Date.now() + DEADLINE_MS);

    const read = await span.source.fetchBlob(BLOB, openSignal());

    expect(read).toEqual({
      ok: true,
      value: { kind: BlobReadKinds.UNREADABLE },
    });
  });

  it("hands each compare the time left before the deadline", async () => {
    const deadlines: (number | undefined)[] = [];
    const reader = stubReader({
      fetchCheckedCompareDiff: async (span) => {
        deadlines.push(span.deadlineMs);
        return { ok: true, value: "diff" };
      },
    });
    const span = buildApiPrSpanSource(reader, Date.now() + DEADLINE_MS);

    await span.source.fetchPrDiff(SPAN, openSignal());

    expect(deadlines[0]).toBeGreaterThan(0);
    expect(deadlines[0]).toBeLessThanOrEqual(DEADLINE_MS);
  });

  it("rejects a read still running when the deadline aborts", async () => {
    const deadline = new AbortController();
    const reader = stubReader({
      fetchMergeBase: () => new Promise(() => undefined),
    });
    const span = buildApiPrSpanSource(reader, Date.now() + DEADLINE_MS);

    const read = span.source.fetchMergeBase(SPAN, deadline.signal);
    deadline.abort(new Error("deadline"));

    await expect(read).rejects.toThrow("deadline");
  });
});
