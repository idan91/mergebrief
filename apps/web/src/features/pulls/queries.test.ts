// @vitest-environment jsdom
// queryFn behavior for the session list: 401 is the EXPECTED logged-out
// state, 200 parses, a malformed 200 throws typed.
import {
  focusManager,
  QueryClient,
  QueryObserver,
} from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../data/apiFetch";

vi.mock("../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return {
    ...actual,
    apiFetch: vi.fn(),
  };
});

// Mocked so these tests never construct the real process logger; the sink's
// own branch logic is covered in `data/ssrWarnSink*.test.ts`.
vi.mock("../../data/ssrWarnSink", () => ({ getSsrWarnSink: vi.fn() }));

import { apiFetch, ApiError } from "../../data/apiFetch";
import { getSsrWarnSink } from "../../data/ssrWarnSink";
import {
  buildDbBriefContextQueryOptions,
  buildDbBriefLayoutQueryOptions,
  buildDbBriefQueryOptions,
  buildDbComparisonMarksQueryOptions,
  buildDbDeltaQueryOptions,
  buildDbRevisionNarrativeQueryOptions,
  buildPrDiffQueryOptions,
  buildPrMetaQueryOptions,
  buildPrStackQueryOptions,
  buildSessionQueryOptions,
  createSessionReads,
} from "./queries";
import {
  emptySessionPayload,
  type SessionReadListener,
} from "../review/session";

const apiFetchMock = vi.mocked(apiFetch);

/** A fresh response per call: a body is read once. */
function answerText(status: number, text: string): void {
  apiFetchMock.mockImplementation(() =>
    Promise.resolve(new Response(text, { status })),
  );
}

function resolveBodyText(body: object): void {
  answerText(200, JSON.stringify(body));
}
const getSsrWarnSinkMock = vi.mocked(getSsrWarnSink);

function runMarks(): Promise<unknown> {
  const options = buildDbComparisonMarksQueryOptions(
    "424242",
    7,
    "head-0",
    "head-1",
    "previous-brief",
    3,
  );
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") {
    throw new Error("expected a queryFn");
  }
  return (queryFn as () => Promise<unknown>)();
}

describe("buildDbComparisonMarksQueryOptions queryFn", () => {
  it("parses the coordinates-only body, synthesizing label + index", async () => {
    // The DB body carries NO baselineLabel/baselineIndex; persistence
    // rejects them at write time. The queryFn must still yield a
    // renderer-ready ComparisonMarks.
    resolveBodyText({
      baselineSha: "head-0",
      headSha: "head-1",
      files: [
        {
          file: "src/a.ts",
          addedRanges: [{ start: 1, end: 2 }],
          removedRanges: [],
        },
      ],
    });
    await expect(runMarks()).resolves.toMatchObject({
      baselineSha: "head-0",
      baselineLabel: "previous-brief",
      baselineIndex: 3,
    });
  });

  it("throws typed malformed on a bad body", async () => {
    resolveBodyText({ nope: true });
    await expect(runMarks()).rejects.toMatchObject({ code: "malformed" });
  });
});

function runPrMeta(): Promise<unknown> {
  const options = buildPrMetaQueryOptions("424242", 7);
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") {
    throw new Error("expected a queryFn");
  }
  return (queryFn as () => Promise<unknown>)();
}

// The resolve capability reaches the affordances THROUGH this queryFn, and
// route tests that seed the cache bypass the parser entirely, so the wire
// body is exercised here, shaped like the real pr-view response.
describe("buildPrMetaQueryOptions queryFn and the resolve capability", () => {
  const META_BODY = {
    repoId: "424242",
    repoSlug: "octo/hello",
    prNumber: 7,
    title: "feat: widgets",
    state: "open",
    baseSha: "base-1",
    headSha: "head-1",
    briefAvailable: true,
    draft: false,
    viewerIsAuthor: false,
    viewerCanResolve: true,
    appInstalled: true,
    behind: false,
    generation: {
      status: "succeeded",
      phase: null,
      attempts: 0,
      errorCode: null,
      errorParams: null,
      updatedAt: "2026-07-30T12:00:00.000Z",
    },
    updatedAt: "2026-07-30T12:00:00.000Z",
    comparisons: {},
  };

  it("carries the capability off a realistic pr-view body", async () => {
    resolveBodyText(META_BODY);
    await expect(runPrMeta()).resolves.toMatchObject({
      viewerCanResolve: true,
      appInstalled: true,
      behind: false,
    });
  });
});

function runBrief(): Promise<unknown> {
  const options = buildDbBriefQueryOptions("424242", 7, "base-1", "head-1");
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") {
    throw new Error("expected a queryFn");
  }
  return (queryFn as () => Promise<unknown>)();
}

function runSession(): Promise<unknown> {
  const options = buildSessionQueryOptions("424242", 7, "base-1", "head-1");
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") {
    throw new Error("expected a queryFn");
  }
  return (queryFn as () => Promise<unknown>)();
}

describe("buildSessionQueryOptions queryFn", () => {
  it("reads the session from the operation row naming its Brief", async () => {
    resolveBodyText({ ...emptySessionPayload(), reviewOutcome: "approve" });

    await expect(runSession()).resolves.toMatchObject({
      reviewOutcome: "approve",
    });
    expect(apiFetchMock.mock.lastCall?.[0]).toBe(
      "/api/repos/424242/pulls/7/session?base=base-1&head=head-1",
    );
  });
});

function runDelta(): Promise<unknown> {
  const options = buildDbDeltaQueryOptions("424242", 7, "cp-1", "head-1");
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") {
    throw new Error("expected a queryFn");
  }
  return (queryFn as () => Promise<unknown>)();
}

describe("buildDbDeltaQueryOptions queryFn", () => {
  const prRef = {
    repo: "octo/hello",
    number: 7,
    title: "t",
    url: "https://github.com/octo/hello/pull/7",
    sha: "head-1",
    description: "",
  };

  it("parses the delta artifact shape with changedGroups", async () => {
    resolveBodyText({
      pr: prRef,
      baselineSha: "cp-1",
      headSha: "head-1",
      baselineIndex: 1,
      headIndex: 2,
      generation: { provider: "anthropic", model: "m", effort: null },
      summary: "delta summary",
      commentsAddressed: "none",
      wholePrImpact: "small",
      changedGroups: [],
      chunks: [],
    });
    await expect(runDelta()).resolves.toMatchObject({
      artifactKind: "delta",
      baselineSha: "cp-1",
      summary: "delta summary",
    });
  });

  it("throws typed malformed on a whole-brief body at the delta endpoint", async () => {
    resolveBodyText({
      pr: prRef,
      summary: "brief summary",
      changeGroups: [],
      chunks: [],
      concernView: [],
    });
    await expect(runDelta()).rejects.toMatchObject({ code: "malformed" });
  });
});

describe("buildDbBriefLayoutQueryOptions queryFn", () => {
  const COUNTS = {
    rows: 4,
    hunkRows: 1,
    expandRows: 1,
    splitRows: 3,
    lineWidths: { counts: [3, 1, 0, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
  };
  const LAYOUT = {
    chunks: { c1: COUNTS },
    files: { "src/orphan.ts": COUNTS },
  };

  function runLayout(): Promise<unknown> {
    const options = buildDbBriefLayoutQueryOptions("424242", 7, "base", "head");
    const queryFn = options.queryFn;
    if (typeof queryFn !== "function") {
      throw new Error("expected a queryFn");
    }
    return (queryFn as () => Promise<unknown>)();
  }

  it("parses the stored counts", async () => {
    resolveBodyText({ layout: LAYOUT });
    await expect(runLayout()).resolves.toEqual({ body: LAYOUT });
  });

  it("parses a card's stored row runs and split widths", async () => {
    const withRowRuns = {
      ...COUNTS,
      splitLineWidths: {
        counts: [2, 1, 0, 0, 0, 0, 0, 0, 0],
        overflowColumns: 0,
      },
      rowRuns: "h1c1a1c1e1",
    };
    const layout = { chunks: { c1: withRowRuns }, files: {} };
    resolveBodyText({ layout });

    await expect(runLayout()).resolves.toEqual({ body: layout });
  });

  it("reads a brief without stored counts as no layout", async () => {
    resolveBodyText({ layout: null });
    await expect(runLayout()).resolves.toEqual({});
  });

  it("settles a brief without counts with no console error", async () => {
    resolveBodyText({ layout: null });
    const consoleError = vi.spyOn(console, "error").mockReturnValue();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const options = buildDbBriefLayoutQueryOptions("424242", 7, "base", "head");

    await client.prefetchQuery(options);

    const state = client.getQueryState(options.queryKey);
    expect(state?.status).toBe("success");
    expect(state?.data).toEqual({});
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("throws typed malformed on a body beyond counts", async () => {
    const extra = { ...LAYOUT, chunks: { c1: { ...COUNTS, content: "x" } } };
    resolveBodyText({ layout: extra });
    await expect(runLayout()).rejects.toMatchObject({ code: "malformed" });
  });

  it("rejects a span no brief covers", async () => {
    answerText(404, JSON.stringify({ error: "Not found", code: "not-found" }));
    await expect(runLayout()).rejects.toBeInstanceOf(ApiError);
  });

  it("rethrows any other failure", async () => {
    answerText(500, JSON.stringify({ error: "boom", code: "internal" }));
    await expect(runLayout()).rejects.toBeInstanceOf(ApiError);
  });
});

describe("the SSR warn sink on the brief and session queryFns", () => {
  const prRef = {
    repo: "octo/hello",
    number: 7,
    title: "t",
    url: "https://github.com/octo/hello/pull/7",
    sha: "head-1",
    description: "",
  };

  function briefBody(readingOrder: unknown) {
    return {
      pr: prRef,
      summary: "s",
      changeGroups: [
        {
          id: "g1",
          title: "t",
          summary: "s",
          dominantCategory: "bugfix",
          secondaryCategories: [],
          uncertain: false,
          uncertainBetween: [],
        },
      ],
      chunks: [
        {
          id: "c1",
          changeGroupId: "g1",
          file: "a.ts",
          concern: "implementation",
          role: "core",
          loc: { added: 1, deleted: 0 },
          addedRanges: [],
          removedRanges: [],
          riskSurface: [],
        },
      ],
      concernView: [{ concern: "implementation", added: 1, deleted: 0 }],
      readingOrder,
    };
  }

  it("routes a stored-body repair to the SSR sink as code and path", async () => {
    // The route loaders SSR-prefetch this queryFn, so this is the ONLY signal
    // an operator gets when a stored Brief needed a repair.
    const warn = vi.fn();
    getSsrWarnSinkMock.mockResolvedValue({ warn });
    resolveBodyText(briefBody("not an array"));

    await expect(runBrief()).resolves.toMatchObject({ summary: "s" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[1]).toEqual({
      code: "dropped-section",
      path: "readingOrder",
    });
  });

  it("routes a malformed session payload to the SSR sink before it throws", async () => {
    // Route-loader prefetch absorbs the rejection into cache state and the UI
    // degrades to read-only; without this line nothing tells the operator.
    const warn = vi.fn();
    getSsrWarnSinkMock.mockResolvedValue({ warn });
    resolveBodyText({ reviewOutcome: "nonsense" });

    await expect(runSession()).rejects.toBeInstanceOf(ApiError);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(
      "malformed review-session payload",
    );
    expect(warn.mock.calls[0]?.[1]).toEqual({ reason: expect.any(String) });
  });

  it("throws typed with no sink in the browser", async () => {
    getSsrWarnSinkMock.mockResolvedValue(undefined);
    resolveBodyText({ reviewOutcome: "nonsense" });
    await expect(runSession()).rejects.toBeInstanceOf(ApiError);
  });

  it("carries the pr lifecycle snapshot off the wire", async () => {
    getSsrWarnSinkMock.mockResolvedValue(undefined);
    const body = briefBody(undefined);
    resolveBodyText({
      ...body,
      pr: { ...prRef, state: "open", draft: true, merged: false },
    });
    await expect(runBrief()).resolves.toMatchObject({
      pr: { state: "open", draft: true, merged: false },
    });
  });
});

describe("buildPrStackQueryOptions polling", () => {
  const pollMs = 30_000;
  let stopObserving: (() => void) | undefined;

  afterEach(() => {
    stopObserving?.();
    stopObserving = undefined;
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  function observeStack(): void {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.mount();
    const observer = new QueryObserver(
      client,
      buildPrStackQueryOptions("424242", 7),
    );
    const unsubscribe = observer.subscribe(() => undefined);
    stopObserving = () => {
      unsubscribe();
      client.unmount();
      client.clear();
    };
  }

  it("refetches the stack every thirty seconds while the tab is visible", async () => {
    vi.useFakeTimers();
    apiFetchMock.mockReset();
    resolveBodyText({ stack: null });
    observeStack();

    await vi.advanceTimersByTimeAsync(pollMs - 1_000);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  it("backs off while GitHub is unavailable and resumes on success", async () => {
    vi.useFakeTimers();
    apiFetchMock.mockReset();
    resolveBodyText({ stack: null });
    observeStack();
    await vi.advanceTimersByTimeAsync(0);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    apiFetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ error: "refused", code: "github-unavailable" }),
        { status: 502 },
      ),
    );
    await vi.advanceTimersByTimeAsync(pollMs);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(pollMs);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(pollMs);
    expect(apiFetchMock).toHaveBeenCalledTimes(3);

    await vi.advanceTimersByTimeAsync(pollMs);
    expect(apiFetchMock).toHaveBeenCalledTimes(4);
  });

  it("pauses while the tab is hidden and catches up on focus", async () => {
    vi.useFakeTimers();
    apiFetchMock.mockReset();
    resolveBodyText({ stack: null });
    observeStack();
    await vi.advanceTimersByTimeAsync(0);

    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(pollMs * 2);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("buildPrDiffQueryOptions", () => {
  const pinnedBase = "a".repeat(40);
  const pinnedHead = "b".repeat(40);
  const minuteMs = 60 * 1000;
  let stopObserving: (() => void) | undefined;

  afterEach(() => {
    stopObserving?.();
    stopObserving = undefined;
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  function observeDiff(base: string, head: string): void {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.mount();
    const observer = new QueryObserver(
      client,
      buildPrDiffQueryOptions("424242", 7, base, head),
    );
    const unsubscribe = observer.subscribe(() => undefined);
    stopObserving = () => {
      unsubscribe();
      client.unmount();
      client.clear();
    };
  }

  async function refocusAfter(ms: number): Promise<void> {
    await vi.advanceTimersByTimeAsync(0);
    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(ms);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
  }

  it("never rereads a diff pinned to two full SHAs on window focus", async () => {
    vi.useFakeTimers();
    apiFetchMock.mockReset();
    answerText(200, "diff --git a/f b/f");
    observeDiff(pinnedBase, pinnedHead);

    await refocusAfter(10 * minuteMs);

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
  });

  it("rereads a span naming a branch on focus once it is stale", async () => {
    vi.useFakeTimers();
    apiFetchMock.mockReset();
    answerText(200, "diff --git a/f b/f");
    observeDiff("main", pinnedHead);

    await refocusAfter(2 * minuteMs);

    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps a diff of a few hundred files for thirty minutes", () => {
    const options = buildPrDiffQueryOptions("424242", 7, "b", "h", 300);

    expect(options.gcTime).toBe(30 * minuteMs);
  });

  it("keeps a very large or unsized diff for five minutes", () => {
    const large = buildPrDiffQueryOptions("424242", 7, "b", "h", 301);
    const unsized = buildPrDiffQueryOptions("424242", 7, "b", "h");

    expect(large.gcTime).toBe(5 * minuteMs);
    expect(unsized.gcTime).toBe(5 * minuteMs);
  });
});

describe("createSessionReads", () => {
  const span = ["424242", 7, "base-1", "head-1"] as const;
  let stopObserving: (() => void) | undefined;

  afterEach(() => {
    stopObserving?.();
    stopObserving = undefined;
    focusManager.setFocused(undefined);
    vi.useRealTimers();
  });

  function makeListener(pending = false) {
    const events: string[] = [];
    const listener: SessionReadListener = {
      startRead: () => events.push("start"),
      landRead: (payload) => events.push(`land:${payload.reviewOutcome}`),
      hasPendingWrite: () => pending,
    };
    return { events, listener };
  }

  it("tells the store when a session read starts and when it lands", async () => {
    apiFetchMock.mockReset();
    resolveBodyText({ ...emptySessionPayload(), reviewOutcome: "approve" });
    const client = new QueryClient();
    const reads = createSessionReads(client, ...span);
    const { events, listener } = makeListener();
    const unsubscribe = reads.subscribe(listener);

    await client.fetchQuery(buildSessionQueryOptions(...span));

    expect(events).toEqual(["start", "land:approve"]);
    unsubscribe();
    client.clear();
  });

  it("ignores a read of another Brief's session", async () => {
    apiFetchMock.mockReset();
    resolveBodyText(emptySessionPayload());
    const client = new QueryClient();
    const reads = createSessionReads(client, ...span);
    const { events, listener } = makeListener();
    reads.subscribe(listener);

    await client.fetchQuery(
      buildSessionQueryOptions("424242", 7, "base-1", "head-2"),
    );

    expect(events).toEqual([]);
    client.clear();
  });

  it("holds the focus refetch while the store has a write pending", async () => {
    vi.useFakeTimers();
    apiFetchMock.mockReset();
    resolveBodyText(emptySessionPayload());
    const client = new QueryClient();
    client.mount();
    const reads = createSessionReads(client, ...span);
    let pending = true;
    reads.subscribe({
      startRead: () => undefined,
      landRead: () => undefined,
      hasPendingWrite: () => pending,
    });
    const observer = new QueryObserver(
      client,
      buildSessionQueryOptions(...span, reads),
    );
    const unsubscribe = observer.subscribe(() => undefined);
    stopObserving = () => {
      unsubscribe();
      client.unmount();
      client.clear();
    };
    await vi.advanceTimersByTimeAsync(0);

    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(apiFetchMock).toHaveBeenCalledTimes(1);

    pending = false;
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(apiFetchMock).toHaveBeenCalledTimes(2);
  });

  function observeSessions(client: QueryClient, ...heads: string[]): void {
    const unsubscribes = heads.map((head) =>
      new QueryObserver(
        client,
        buildSessionQueryOptions("424242", 7, "base-1", head),
      ).subscribe(() => undefined),
    );
    stopObserving = () => {
      for (const unsubscribe of unsubscribes) {
        unsubscribe();
      }
      client.clear();
    };
  }

  it("rereads only its own Brief's session query", async () => {
    vi.useFakeTimers();
    apiFetchMock.mockReset();
    resolveBodyText(emptySessionPayload());
    const client = new QueryClient();
    observeSessions(client, "head-1", "head-2");
    await vi.advanceTimersByTimeAsync(0);
    apiFetchMock.mockClear();

    createSessionReads(client, ...span).requestRead();
    await vi.advanceTimersByTimeAsync(0);

    expect(apiFetchMock).toHaveBeenCalledTimes(1);
    expect(apiFetchMock.mock.calls[0]?.[0]).toContain("head=head-1");
  });

  it("never rereads a session query no screen observes", async () => {
    vi.useFakeTimers();
    apiFetchMock.mockReset();
    resolveBodyText(emptySessionPayload());
    const client = new QueryClient();
    await client.fetchQuery(buildSessionQueryOptions(...span));
    observeSessions(client, "head-2");
    await vi.advanceTimersByTimeAsync(0);
    apiFetchMock.mockClear();

    createSessionReads(client, ...span).requestRead();
    await vi.advanceTimersByTimeAsync(0);

    expect(apiFetchMock).not.toHaveBeenCalled();
  });
});

function runQuery(options: { readonly queryFn?: unknown }): Promise<unknown> {
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") {
    throw new Error("expected a queryFn");
  }
  return (queryFn as () => Promise<unknown>)();
}

describe("the pull reads take their path from the operation row", () => {
  const pull = "/api/repos/424242/pulls/7";

  it.each([
    ["pr meta", buildPrMetaQueryOptions("424242", 7), pull],
    ["stack", buildPrStackQueryOptions("424242", 7), `${pull}/stack`],
    [
      "brief",
      buildDbBriefQueryOptions("424242", 7, "base-1", "head-1"),
      `${pull}/brief?base=base-1&head=head-1`,
    ],
    [
      "brief context",
      buildDbBriefContextQueryOptions("424242", 7, "base-1", "head-1"),
      `${pull}/brief-context?base=base-1&head=head-1`,
    ],
    [
      "marks",
      buildDbComparisonMarksQueryOptions(
        "424242",
        7,
        "head-0",
        "head-1",
        "previous-brief",
        3,
      ),
      `${pull}/marks?baseline=head-0&head=head-1`,
    ],
    [
      "delta",
      buildDbDeltaQueryOptions("424242", 7, "cp-1", "head-1"),
      `${pull}/delta?baseline=cp-1&head=head-1`,
    ],
    [
      "narrative",
      buildDbRevisionNarrativeQueryOptions("424242", 7, "head-0", "head-1"),
      `${pull}/narrative?prevHead=head-0&head=head-1`,
    ],
  ])("reads the %s at its row's path", async (_read, options, path) => {
    apiFetchMock.mockReset();
    resolveBodyText({});

    await runQuery(options).catch(() => undefined);

    expect(apiFetchMock).toHaveBeenCalledWith(path, { method: "GET" });
  });

  it("reads the diff at its row's path as the preload link fetches it", async () => {
    apiFetchMock.mockReset();
    answerText(200, "diff --git a/f b/f");

    await runQuery(buildPrDiffQueryOptions("424242", 7, "base-1", "head-1"));

    expect(apiFetchMock).toHaveBeenCalledWith(
      `${pull}/diff?base=base-1&head=head-1`,
      { method: "GET", credentials: "include" },
    );
  });
});

describe("buildDbBriefContextQueryOptions queryFn", () => {
  const options = buildDbBriefContextQueryOptions(
    "424242",
    7,
    "base-1",
    "head-1",
  );

  it("reads a recorded-nothing context as null", async () => {
    resolveBodyText({ repoConfig: null });
    await expect(runQuery(options)).resolves.toBeNull();
  });

  it("throws typed malformed on a body without the envelope", async () => {
    resolveBodyText({ nope: true });
    await expect(runQuery(options)).rejects.toMatchObject({
      code: "malformed",
    });
  });
});
