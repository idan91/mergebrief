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
  return { ...actual, apiFetch: vi.fn(), apiFetchJson: vi.fn() };
});

// Mocked so these tests never construct the real process logger; the sink's
// own branch logic is covered in `data/ssrWarnSink*.test.ts`.
vi.mock("../../data/ssrWarnSink", () => ({ getSsrWarnSink: vi.fn() }));

import { apiFetchJson, ApiError } from "../../data/apiFetch";
import { getSsrWarnSink } from "../../data/ssrWarnSink";
import {
  buildDbBriefQueryOptions,
  buildDbComparisonMarksQueryOptions,
  buildDbDeltaQueryOptions,
  buildPrMetaQueryOptions,
  buildPrStackQueryOptions,
  buildSessionQueryOptions,
} from "./queries";

const apiFetchJsonMock = vi.mocked(apiFetchJson);
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
  if (typeof queryFn !== "function") throw new Error("expected a queryFn");
  return (queryFn as () => Promise<unknown>)();
}

describe("buildDbComparisonMarksQueryOptions queryFn", () => {
  it("parses the coordinates-only body, synthesizing label + index", async () => {
    // The DB body carries NO baselineLabel/baselineIndex; persistence
    // rejects them at write time. The queryFn must still yield a
    // renderer-ready ComparisonMarks.
    apiFetchJsonMock.mockResolvedValue({
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
    apiFetchJsonMock.mockResolvedValue({ nope: true });
    await expect(runMarks()).rejects.toMatchObject({ code: "malformed" });
  });
});

function runPrMeta(): Promise<unknown> {
  const options = buildPrMetaQueryOptions("424242", 7);
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") throw new Error("expected a queryFn");
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
    apiFetchJsonMock.mockResolvedValue(META_BODY);
    await expect(runPrMeta()).resolves.toMatchObject({
      viewerCanResolve: true,
      appInstalled: true,
      behind: false,
    });
  });

  it("fails closed on a body from a server predating the field", async () => {
    const { viewerCanResolve: _absent, ...older } = META_BODY;
    apiFetchJsonMock.mockResolvedValue(older);
    await expect(runPrMeta()).resolves.toMatchObject({
      viewerCanResolve: false,
      appInstalled: true,
      behind: false,
    });
  });

  it("throws typed malformed when the capability is not a boolean", async () => {
    apiFetchJsonMock.mockResolvedValue({
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
  if (typeof queryFn !== "function") throw new Error("expected a queryFn");
  return (queryFn as () => Promise<unknown>)();
}

function runSession(): Promise<unknown> {
  const options = buildSessionQueryOptions("424242", 7, "base-1", "head-1");
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") throw new Error("expected a queryFn");
  return (queryFn as () => Promise<unknown>)();
}

function runDelta(): Promise<unknown> {
  const options = buildDbDeltaQueryOptions("424242", 7, "cp-1", "head-1");
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") throw new Error("expected a queryFn");
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
    // The worker stores `JSON.stringify(delta)` - the delta-CLI shape with
    // `changedGroups`/`commentsAddressed`/`wholePrImpact`. parseBrief rejects
    // it, which silently degraded the pane to marks-only.
    apiFetchJsonMock.mockResolvedValue({
      pr: prRef,
      baselineSha: "cp-1",
      headSha: "head-1",
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
    apiFetchJsonMock.mockResolvedValue({
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

  it("routes a lenient drop to the SSR sink so hosted-brief drift is loud", async () => {
    // The route loaders SSR-prefetch this queryFn
    // (`repos.$repoId.pulls.$prNumber.tsx`), so this is the ONLY signal an
    // operator gets when a stored Brief carries a malformed optional section.
    const warn = vi.fn();
    getSsrWarnSinkMock.mockResolvedValue({ warn });
    apiFetchJsonMock.mockResolvedValue(briefBody("not an array"));

    await expect(runBrief()).resolves.toMatchObject({ summary: "s" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(
      "parseBrief: dropping readingOrder",
    );
  });

  it("routes a malformed session payload to the SSR sink before it throws", async () => {
    // Route-loader prefetch absorbs the rejection into cache state and the UI
    // degrades to read-only; without this line nothing tells the operator.
    const warn = vi.fn();
    getSsrWarnSinkMock.mockResolvedValue({ warn });
    apiFetchJsonMock.mockResolvedValue({ reviewOutcome: "nonsense" });

    await expect(runSession()).rejects.toBeInstanceOf(ApiError);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain(
      "malformed review-session payload",
    );
  });

  it("throws typed with no sink in the browser", async () => {
    getSsrWarnSinkMock.mockResolvedValue(undefined);
    apiFetchJsonMock.mockResolvedValue({ reviewOutcome: "nonsense" });
    await expect(runSession()).rejects.toBeInstanceOf(ApiError);
  });

  it("parses fine when the sink is absent on the browser refetch", async () => {
    getSsrWarnSinkMock.mockResolvedValue(undefined);
    apiFetchJsonMock.mockResolvedValue(briefBody("not an array"));
    await expect(runBrief()).resolves.toMatchObject({ summary: "s" });
  });

  it("carries the pr lifecycle snapshot off the wire", async () => {
    getSsrWarnSinkMock.mockResolvedValue(undefined);
    const body = briefBody(undefined);
    apiFetchJsonMock.mockResolvedValue({
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
    const client = new QueryClient();
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
    apiFetchJsonMock.mockReset();
    apiFetchJsonMock.mockResolvedValue({ stack: null });
    observeStack();

    await vi.advanceTimersByTimeAsync(pollMs - 1_000);
    expect(apiFetchJsonMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(apiFetchJsonMock).toHaveBeenCalledTimes(2);
  });

  it("pauses while the tab is hidden and catches up on focus", async () => {
    vi.useFakeTimers();
    apiFetchJsonMock.mockReset();
    apiFetchJsonMock.mockResolvedValue({ stack: null });
    observeStack();
    await vi.advanceTimersByTimeAsync(0);

    focusManager.setFocused(false);
    await vi.advanceTimersByTimeAsync(pollMs * 2);
    expect(apiFetchJsonMock).toHaveBeenCalledTimes(1);

    focusManager.setFocused(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(apiFetchJsonMock).toHaveBeenCalledTimes(2);
  });
});
