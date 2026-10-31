import { GitHubApiErrorCodes, type GitHubCallFailure } from "github";
import type { Result } from "types/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PullRequestAccess } from "../../../../access/types";
import { LARGE_DIFF_CACHE_LIMITS, SPAN_DIFF_CACHE_LIMITS } from "./consts";
import { createLargeDiffCache } from "./logic/large-diff-cache";
import { createSpanDiffCache } from "./logic/span-diff-cache";
import { readDiff } from "./read-diff";
import type { ReadDiffDeps } from "./types";

const DIFF_TEXT = "diff --git a/f b/f\n@@ -1 +1 @@\n-old\n+new\n";
const SPAN = { base: "base1", head: "head1" };
const PINNED_SPAN = { base: "a".repeat(40), head: "b".repeat(40) };
const MINUTE_MS = 60 * 1000;

type CompareReply = Result<string, GitHubCallFailure>;

function makeDeps(): ReadDiffDeps {
  return {
    diffCache: createSpanDiffCache(SPAN_DIFF_CACHE_LIMITS),
    largeDiffCache: createLargeDiffCache(LARGE_DIFF_CACHE_LIMITS),
    diffFetches: new Map(),
  };
}

function stubAccess(
  fetchCheckedCompareDiff: () => Promise<CompareReply>,
): PullRequestAccess {
  const access = {
    repoFullName: "octo/hello",
    repoId: 424242n,
    prNumber: 7,
    session: { sessionTokenHash: "session-hash" },
    github: { forRepo: () => ({ fetchCheckedCompareDiff }) },
  };
  return access as unknown as PullRequestAccess;
}

function stubHeldCompare() {
  let answer: (reply: CompareReply) => void = () => undefined;
  const pending = new Promise<CompareReply>((resolve) => {
    answer = resolve;
  });
  const fetchCompare = vi.fn(() => pending);
  return { fetchCompare, answer };
}

describe("readDiff", () => {
  it("shares one GitHub call between two concurrent reads of a span", async () => {
    const deps = makeDeps();
    const held = stubHeldCompare();
    const access = stubAccess(held.fetchCompare);

    const first = readDiff(deps, access, SPAN);
    const second = readDiff(deps, access, SPAN);
    held.answer({ ok: true, value: DIFF_TEXT });

    expect(await first).toEqual({ ok: true, value: DIFF_TEXT });
    expect(await second).toEqual({ ok: true, value: DIFF_TEXT });
    expect(held.fetchCompare).toHaveBeenCalledTimes(1);
    expect(deps.diffFetches.size).toBe(0);
  });

  it("caches nothing when the GitHub call fails", async () => {
    const deps = makeDeps();
    const failure: GitHubCallFailure = {
      code: GitHubApiErrorCodes.REQUEST_FAILED,
      status: 502,
      message: "fetch compare diff failed",
    };
    const fetchCompare = vi
      .fn<() => Promise<CompareReply>>()
      .mockResolvedValueOnce({ ok: false, error: failure })
      .mockResolvedValueOnce({ ok: true, value: DIFF_TEXT });
    const access = stubAccess(fetchCompare);

    const failed = await readDiff(deps, access, SPAN);
    const retried = await readDiff(deps, access, SPAN);

    expect(failed.ok).toBe(false);
    expect(retried).toEqual({ ok: true, value: DIFF_TEXT });
    expect(fetchCompare).toHaveBeenCalledTimes(2);
    expect(deps.diffFetches.size).toBe(0);
  });
});

describe("readDiff cache lifetime", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function readAt(
    deps: ReadDiffDeps,
    access: PullRequestAccess,
    span: { base: string; head: string },
    at: number,
  ) {
    vi.spyOn(Date, "now").mockReturnValue(at);
    return readDiff(deps, access, span);
  }

  it("keeps a span between two full SHAs for thirty minutes", async () => {
    const deps = makeDeps();
    const fetchCompare = vi.fn(
      async (): Promise<CompareReply> => ({
        ok: true,
        value: DIFF_TEXT,
      }),
    );
    const access = stubAccess(fetchCompare);

    await readAt(deps, access, PINNED_SPAN, 0);
    await readAt(deps, access, PINNED_SPAN, 29 * MINUTE_MS);
    const callsInside = fetchCompare.mock.calls.length;
    await readAt(deps, access, PINNED_SPAN, 31 * MINUTE_MS);

    expect(callsInside).toBe(1);
    expect(fetchCompare).toHaveBeenCalledTimes(2);
  });

  it("re-reads a span naming a branch after a minute", async () => {
    const deps = makeDeps();
    const fetchCompare = vi.fn(
      async (): Promise<CompareReply> => ({
        ok: true,
        value: DIFF_TEXT,
      }),
    );
    const access = stubAccess(fetchCompare);
    const branchSpan = { base: "main", head: "b".repeat(40) };

    await readAt(deps, access, branchSpan, 0);
    await readAt(deps, access, branchSpan, 2 * MINUTE_MS);

    expect(fetchCompare).toHaveBeenCalledTimes(2);
  });
});
