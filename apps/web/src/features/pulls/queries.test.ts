// queryFn behavior for the session list (BRIEF-19 PR 3.1): 401 is the
// EXPECTED logged-out state, 200 parses, a malformed 200 throws typed.
import { describe, expect, it, vi } from "vitest";

import type * as ApiFetchModule from "../../data/apiFetch";

vi.mock("../../data/apiFetch", async (importOriginal) => {
  const actual = await importOriginal<typeof ApiFetchModule>();
  return { ...actual, apiFetch: vi.fn(), apiFetchJson: vi.fn() };
});

import { apiFetch, apiFetchJson, ApiError } from "../../data/apiFetch";
import {
  dbComparisonMarksQueryOptions,
  pullsSessionQueryOptions,
} from "./queries";

const apiFetchMock = vi.mocked(apiFetch);
const apiFetchJsonMock = vi.mocked(apiFetchJson);

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
