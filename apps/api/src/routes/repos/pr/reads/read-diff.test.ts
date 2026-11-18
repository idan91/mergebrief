import { IN_PROCESS_SPAN_RUNNER } from "brief-core/pr-span";
import { DiffModes } from "contract";
import {
  GitHubApiErrorCodes,
  RepoFileKinds,
  type GitHubCallFailure,
} from "github";
import type { Result } from "types/utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PullRequestAccess } from "../../../../access/types";
import { LARGE_DIFF_CACHE_LIMITS, SPAN_DIFF_CACHE_LIMITS } from "./consts";
import { createLargeDiffCache } from "./logic/large-diff-cache";
import {
  GatewayTimeout,
  PayloadTooLarge,
} from "../../../../shared-errors/api-error";
import { SpanThreadError } from "./logic/span-thread";
import { createSpanDiffCache } from "./logic/span-diff-cache";
import { resolveDiffError } from "./logic/wire-failures";
import { readDiff } from "./read-diff";
import { SpanReadKinds, type ReadDiffDeps, type SpanKeyReader } from "./types";

const DIFF_TEXT = "diff --git a/f b/f\n@@ -1 +1 @@\n-old\n+new\n";
const SPAN = { base: "base1", head: "head1" };
const PINNED_SPAN = { base: "a".repeat(40), head: "b".repeat(40) };
const MINUTE_MS = 60 * 1000;

type CompareReply = Result<string, GitHubCallFailure>;

const COMPARE_PAIRS: SpanKeyReader = {
  classify: async () => ({ kind: SpanReadKinds.COMPARE }),
};

function makeDeps(spanKeys: SpanKeyReader = COMPARE_PAIRS): ReadDiffDeps {
  return {
    diffCache: createSpanDiffCache(SPAN_DIFF_CACHE_LIMITS),
    largeDiffCache: createLargeDiffCache(LARGE_DIFF_CACHE_LIMITS),
    diffFetches: new Map(),
    spanKeys,
    spanRunner: {
      ...IN_PROCESS_SPAN_RUNNER,
      runLineDiff: async () => undefined,
    },
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

    expect((await first).read).toEqual({ ok: true, value: DIFF_TEXT });
    expect((await second).read).toEqual({ ok: true, value: DIFF_TEXT });
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

    expect(failed.read.ok).toBe(false);
    expect(retried.read).toEqual({ ok: true, value: DIFF_TEXT });
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

const PREV_BASE = "c".repeat(40);
const NEW_BASE = "e".repeat(40);
const MERGE_BASE = "d".repeat(40);
const PREV_HEAD = "1".repeat(40);
const NEW_HEAD = "2".repeat(40);
const SPAN_PAIR = { base: PREV_HEAD, head: NEW_HEAD };
const SPAN_TEXT = "diff --git a/g b/g\n@@ -1 +1 @@\n-was\n+now\n";
const SPAN_REFS = {
  prevBase: PREV_BASE,
  prevHead: PREV_HEAD,
  newBase: NEW_BASE,
  newHead: NEW_HEAD,
};
const MARKED_SPAN: SpanKeyReader = {
  classify: async () => ({ kind: SpanReadKinds.SPAN, refs: SPAN_REFS }),
};

/** A fast-forward on one merge base: the span is GitHub's diff between the heads. */
function stubSpanAccess(
  mergeBases: () => Promise<Result<string, GitHubCallFailure>>,
) {
  const fetchCheckedCompareDiff = vi.fn(
    async (span: { base: string; head: string }): Promise<CompareReply> => ({
      ok: true,
      value: span.base === PREV_HEAD ? SPAN_TEXT : DIFF_TEXT,
    }),
  );
  const access = {
    repoFullName: "octo/hello",
    repoId: 424242n,
    prNumber: 7,
    session: { sessionTokenHash: "session-hash" },
    github: {
      forRepo: () => ({
        fetchCheckedCompareDiff,
        fetchMergeBase: mergeBases,
        fetchRepoFile: vi.fn(),
      }),
    },
  };
  return {
    access: access as unknown as PullRequestAccess,
    fetchCheckedCompareDiff,
  };
}

function answerFastForward(span: { base: string; head: string }) {
  return Promise.resolve({
    ok: true as const,
    value: span.base === PREV_HEAD ? PREV_HEAD : MERGE_BASE,
  });
}

describe("readDiff revision span", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("serves a marked pair's span text and names the mode", async () => {
    const { access } = stubSpanAccess(
      answerFastForward as () => Promise<Result<string, GitHubCallFailure>>,
    );

    const served = await readDiff(makeDeps(MARKED_SPAN), access, SPAN_PAIR);

    expect(served).toEqual({
      mode: DiffModes.REVISION_SPAN,
      read: { ok: true, value: SPAN_TEXT },
    });
  });

  it("refuses a pair the worker stored as refused, with no GitHub read", async () => {
    const refused: SpanKeyReader = {
      classify: async () => ({ kind: SpanReadKinds.REFUSED }),
    };
    const { access, fetchCheckedCompareDiff } = stubSpanAccess(vi.fn());

    const served = await readDiff(makeDeps(refused), access, SPAN_PAIR);

    expect(served).toEqual({
      mode: DiffModes.REVISION_SPAN,
      read: { ok: false, error: { kind: "span-too-large" } },
    });
    expect(fetchCheckedCompareDiff).not.toHaveBeenCalled();
  });

  it("answers every waiter past the deadline as a timeout", async () => {
    const deadline = new AbortController();
    vi.spyOn(AbortSignal, "timeout").mockReturnValue(deadline.signal);
    const { access } = stubSpanAccess(() => new Promise(() => undefined));
    const deps = makeDeps(MARKED_SPAN);

    const first = readDiff(deps, access, SPAN_PAIR);
    const second = readDiff(deps, access, SPAN_PAIR);
    await vi.waitFor(() => {
      expect(deps.diffFetches.size).toBe(1);
    });
    deadline.abort(new Error("deadline"));

    const past = { ok: false, error: { kind: "deadline" } };
    expect((await first).read).toEqual(past);
    expect((await second).read).toEqual(past);
  });

  it.each([
    [
      "a render timeout",
      GitHubApiErrorCodes.DIFF_TIMED_OUT,
      422,
      GatewayTimeout,
    ],
    [
      "a refused size",
      GitHubApiErrorCodes.REQUEST_FAILED,
      406,
      PayloadTooLarge,
    ],
  ])(
    "answers %s on a marked pair as GitHub did",
    async (_label, code, status, answer) => {
      const refused: GitHubCallFailure = { code, status, message: "refused" };
      const { access, fetchCheckedCompareDiff } = stubSpanAccess(
        answerFastForward as () => Promise<Result<string, GitHubCallFailure>>,
      );
      fetchCheckedCompareDiff.mockResolvedValue({
        ok: false,
        error: refused,
      });

      const served = await readDiff(makeDeps(MARKED_SPAN), access, SPAN_PAIR);

      expect(served.read).toEqual({
        ok: false,
        error: { kind: "github-denied", error: refused },
      });
      expect(
        served.read.ok || resolveDiffError(served.read.error),
      ).toBeInstanceOf(answer);
    },
  );

  it("fails the read when the span key cannot be read", async () => {
    const broken: SpanKeyReader = {
      classify: async () => {
        throw new Error("connection terminated");
      },
    };
    const { access, fetchCheckedCompareDiff } = stubSpanAccess(vi.fn());

    const served = readDiff(makeDeps(broken), access, SPAN_PAIR);

    await expect(served).rejects.toThrow("connection terminated");
    expect(fetchCheckedCompareDiff).not.toHaveBeenCalled();
  });

  it("answers a span whose thread stopped as a timeout", async () => {
    const { access } = stubBuiltSpanAccess();
    const deps: ReadDiffDeps = {
      ...makeDeps(MARKED_SPAN),
      spanRunner: {
        ...IN_PROCESS_SPAN_RUNNER,
        runLineDiff: async () => {
          throw new SpanThreadError("the span thread stopped");
        },
      },
    };

    const served = await readDiff(deps, access, SPAN_PAIR);

    expect(served).toEqual({
      mode: DiffModes.REVISION_SPAN,
      read: { ok: false, error: { kind: "deadline" } },
    });
  });
});

/** g's PR diff at each head, under another head blob. */
function makeHeadPrDiff(headBlob: string, added: string): string {
  return `diff --git a/g b/g\nindex 1111111..${headBlob} 100644\n--- a/g\n+++ b/g\n@@ -1 +1 @@\n-was\n+${added}\n`;
}

/** A push that rewrote history: the span is built, so g's line diff reaches the runner. */
function stubBuiltSpanAccess() {
  const prDiffs = new Map([
    [PREV_BASE, makeHeadPrDiff("2222222", "first")],
    [NEW_BASE, makeHeadPrDiff("3333333", "second")],
  ]);
  const fetchCheckedCompareDiff = vi.fn(
    async (span: { base: string; head: string }): Promise<CompareReply> => ({
      ok: true,
      value: prDiffs.get(span.base) ?? "",
    }),
  );
  const fetchRepoFile = vi.fn(async (file: { ref: string }) => {
    const content = file.ref === PREV_HEAD ? "first\n" : "second\n";
    const blob = { kind: RepoFileKinds.FILE, content, blobSha: file.ref };
    return { ok: true, value: { ...blob, size: content.length } };
  });
  const access = {
    repoFullName: "octo/hello",
    repoId: 424242n,
    prNumber: 7,
    session: { sessionTokenHash: "session-hash" },
    github: {
      forRepo: () => ({
        fetchCheckedCompareDiff,
        fetchMergeBase: async () => ({ ok: true, value: MERGE_BASE }),
        fetchRepoFile,
      }),
    },
  };
  return { access: access as unknown as PullRequestAccess, fetchRepoFile };
}
