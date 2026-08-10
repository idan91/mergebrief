// queryFn behavior for the session list: 401 is the EXPECTED logged-out
// state, 200 parses, a malformed 200 throws typed.
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../data/apiFetch";

vi.mock("../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn(), apiFetchJson: vi.fn() };
});

// Mocked so these tests never construct the real process logger; the sink's
// own branch logic is covered in `data/ssrWarnSink*.test.ts`.
vi.mock("../../data/ssrWarnSink", () => ({ getSsrWarnSink: vi.fn() }));

import { apiFetch, apiFetchJson, ApiError } from "../../data/apiFetch";
import { getSsrWarnSink } from "../../data/ssrWarnSink";
import {
  dbBriefQueryOptions,
  dbComparisonMarksQueryOptions,
  dbDeltaQueryOptions,
  prMetaQueryOptions,
  pullsSessionQueryOptions,
} from "./queries";

const apiFetchMock = vi.mocked(apiFetch);
const apiFetchJsonMock = vi.mocked(apiFetchJson);
const getSsrWarnSinkMock = vi.mocked(getSsrWarnSink);

function run(): Promise<unknown> {
  const options = pullsSessionQueryOptions();
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") throw new Error("expected a queryFn");
  // The queryFn ignores its context for this endpoint.
  return (queryFn as () => Promise<unknown>)();
}

describe("pullsSessionQueryOptions queryFn", () => {
  it("maps a 401 to the logged-out state instead of throwing", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    await expect(run()).resolves.toEqual({ kind: "logged-out" });
  });

  it("parses a 200 into the ready list", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ pulls: [] }), { status: 200 }),
    );
    await expect(run()).resolves.toEqual({ kind: "ready", pulls: [] });
  });

  it("throws a typed malformed error on a 200 with a bad shape", async () => {
    apiFetchMock.mockResolvedValue(
      new Response(JSON.stringify({ nope: true }), { status: 200 }),
    );
    await expect(run()).rejects.toBeInstanceOf(ApiError);
    await expect(run()).rejects.toMatchObject({ kind: "malformed" });
  });

  it("maps a 502 to the unavailable state (picker degrades, local briefs still render)", async () => {
    apiFetchMock.mockResolvedValue(new Response("{}", { status: 502 }));
    await expect(run()).resolves.toEqual({ kind: "unavailable" });
  });
});

function runMarks(): Promise<unknown> {
  const options = dbComparisonMarksQueryOptions(
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

describe("dbComparisonMarksQueryOptions queryFn", () => {
  it("parses the coordinates-only body, synthesizing label + index", async () => {
    // The DB body carries NO baselineLabel/baselineIndex — persistence
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
    await expect(runMarks()).rejects.toMatchObject({ kind: "malformed" });
  });
});

function runPrMeta(): Promise<unknown> {
  const options = prMetaQueryOptions("424242", 7);
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") throw new Error("expected a queryFn");
  return (queryFn as () => Promise<unknown>)();
}

// The resolve capability reaches the affordances THROUGH this queryFn, and
// route tests that seed the cache bypass the parser entirely — so the wire
// body is exercised here, shaped like the real pr-view response.
describe("prMetaQueryOptions queryFn — viewerCanResolve", () => {
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
    generation: {
      status: "succeeded",
      phase: null,
      attempts: 0,
      error: null,
      updatedAt: "2026-07-30T12:00:00.000Z",
    },
    updatedAt: "2026-07-30T12:00:00.000Z",
    comparisons: {},
  };

  it("carries the capability off a realistic pr-view body", async () => {
    apiFetchJsonMock.mockResolvedValue(META_BODY);
    await expect(runPrMeta()).resolves.toMatchObject({
      viewerCanResolve: true,
    });
  });

  it("fails closed on a body from a server predating the field", async () => {
    const { viewerCanResolve: _absent, ...older } = META_BODY;
    apiFetchJsonMock.mockResolvedValue(older);
    await expect(runPrMeta()).resolves.toMatchObject({
      viewerCanResolve: false,
    });
  });

  it("throws typed malformed when the capability is not a boolean", async () => {
    apiFetchJsonMock.mockResolvedValue({
      ...META_BODY,
      viewerCanResolve: "yes",
    });
    await expect(runPrMeta()).rejects.toBeInstanceOf(ApiError);
  });
});

function runBrief(): Promise<unknown> {
  const options = dbBriefQueryOptions("424242", 7, "base-1", "head-1");
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") throw new Error("expected a queryFn");
  return (queryFn as () => Promise<unknown>)();
}

function runDelta(): Promise<unknown> {
  const options = dbDeltaQueryOptions("424242", 7, "cp-1", "head-1");
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") throw new Error("expected a queryFn");
  return (queryFn as () => Promise<unknown>)();
}

describe("dbDeltaQueryOptions queryFn", () => {
  const prRef = {
    repo: "octo/hello",
    number: 7,
    title: "t",
    url: "https://github.com/octo/hello/pull/7",
    sha: "head-1",
    description: "",
  };

  it("parses the DELTA artifact shape (changedGroups, not changeGroups)", async () => {
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

  it("throws typed malformed on a WHOLE-BRIEF body (wrong artifact for this endpoint)", async () => {
    apiFetchJsonMock.mockResolvedValue({
      pr: prRef,
      summary: "brief summary",
      changeGroups: [],
      chunks: [],
      concernView: [],
    });
    await expect(runDelta()).rejects.toMatchObject({ kind: "malformed" });
  });
});

describe("dbBriefQueryOptions queryFn — warn sink", () => {
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

  it("routes a lenient drop to the SSR sink, so hosted-brief drift is not silent", async () => {
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

  it("parses fine when the sink is absent (the browser refetch)", async () => {
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
