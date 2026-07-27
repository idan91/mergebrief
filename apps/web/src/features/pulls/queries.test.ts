// queryFn behavior for the session list (BRIEF-19 PR 3.1): 401 is the
// EXPECTED logged-out state, 200 parses, a malformed 200 throws typed.
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
  it("parses the D13 coordinates-only body, synthesizing label + index", async () => {
    // The DB body carries NO baselineLabel/baselineIndex — persistence rejects
    // them at write time (D13). The queryFn must still yield a renderer-ready
    // ComparisonMarks.
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

  it("parses the DELTA artifact shape (changedGroups, not changeGroups - smoke-found)", async () => {
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

describe("dbBriefQueryOptions queryFn — warn sink (BRIEF-44 PR 6)", () => {
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
          role: "carrier",
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
});
