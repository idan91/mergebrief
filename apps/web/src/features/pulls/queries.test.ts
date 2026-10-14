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

  it("fails closed on a body from a server predating the field", async () => {
    const { viewerCanResolve: _absent, ...older } = META_BODY;
    resolveBodyText(older);
    await expect(runPrMeta()).resolves.toMatchObject({
      viewerCanResolve: false,
      appInstalled: true,
      behind: false,
    });
  });

  it("throws typed malformed when the capability is not a boolean", async () => {
    resolveBodyText({
      ...META_BODY,
      viewerCanResolve: "yes",
      appInstalled: true,
    });
    await expect(runPrMeta()).rejects.toBeInstanceOf(ApiError);
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

  it("reads an outcome this bundle predates as unknown", async () => {
    resolveBodyText({ ...emptySessionPayload(), reviewOutcome: "merge" });
    await expect(runSession()).resolves.toMatchObject({
      reviewOutcome: "unknown",
    });
  });

  it("throws typed malformed on a body that is not JSON", async () => {
    getSsrWarnSinkMock.mockResolvedValue(undefined);
    answerText(200, "not json");
    await expect(runSession()).rejects.toMatchObject({ code: "malformed" });
  });

  it("routes a null session body to the SSR sink before it throws", async () => {
    const warn = vi.fn();
    getSsrWarnSinkMock.mockResolvedValue({ warn });
    answerText(200, "null");

    await expect(runSession()).rejects.toMatchObject({ code: "malformed" });
    expect(warn).toHaveBeenCalledTimes(1);
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

  it("parses fine when the sink is absent on the browser refetch", async () => {
    getSsrWarnSinkMock.mockResolvedValue(undefined);
    resolveBodyText(briefBody("not an array"));
    await expect(runBrief()).resolves.toMatchObject({ summary: "s" });
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
    [
      "diff",
      buildPrDiffQueryOptions("424242", 7, "base-1", "head-1"),
      `${pull}/diff?base=base-1&head=head-1`,
    ],
  ])("reads the %s at its row's path", async (_read, options, path) => {
    apiFetchMock.mockReset();
    resolveBodyText({});

    await runQuery(options).catch(() => undefined);

    expect(apiFetchMock).toHaveBeenCalledWith(path, { method: "GET" });
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

describe("buildPrDiffQueryOptions queryFn", () => {
  const options = buildPrDiffQueryOptions("424242", 7, "base-1", "head-1");

  it("resolves the diff text verbatim", async () => {
    answerText(200, "diff --git a/x b/x\n");
    await expect(runQuery(options)).resolves.toBe("diff --git a/x b/x\n");
  });

  it("throws the typed error the api answered", async () => {
    answerText(
      502,
      JSON.stringify({ error: "refused", code: "github-unavailable" }),
    );
    await expect(runQuery(options)).rejects.toMatchObject({
      code: "github-unavailable",
      status: 502,
    });
  });
});
