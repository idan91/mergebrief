// The file-range read at the head sha: expected rejections are RESULT KINDS
// the expander renders; only a malformed 200 throws.
import { MAX_FILE_RANGE_LINES } from "contract";
import { describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../../data/apiFetch", async (importOriginal) => ({
  ...(await importOriginal()),
  apiFetch,
}));
vi.mock("./server/brief.functions", () => ({
  getLocalBrief: vi.fn(),
  getLocalBriefs: vi.fn(),
  getLocalComparisonMarks: vi.fn(),
  getLocalRevisionChanges: vi.fn(),
  getLocalRevisionNarrative: vi.fn(),
}));

const { fileRangeQueryOptions, isFileRangeReadable } =
  await import("./queries");

const HEAD = "a".repeat(40);

function stubParams(overrides: Record<string, unknown> = {}) {
  return {
    repoId: "repo-1",
    prNumber: 7,
    ref: HEAD,
    path: "src/a.ts",
    from: 2,
    to: 21,
    ...overrides,
  };
}

function stubResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function runQuery(
  overrides: Record<string, unknown> = {},
): Promise<unknown> {
  const options = fileRangeQueryOptions(stubParams(overrides));
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") throw new Error("no queryFn");

  return queryFn({} as never);
}

describe("isFileRangeReadable", () => {
  it("refuses a ref that is not a forty-hex commit sha", () => {
    expect(isFileRangeReadable(stubParams({ ref: "main" }))).toBe(false);
  });

  it("refuses a span past the contract's read cap", () => {
    const past = { from: 1, to: MAX_FILE_RANGE_LINES + 1 };

    expect(isFileRangeReadable(stubParams(past))).toBe(false);
    const capped = { from: 1, to: MAX_FILE_RANGE_LINES };
    expect(isFileRangeReadable(stubParams(capped))).toBe(true);
  });

  it("accepts a window the route will serve", () => {
    expect(isFileRangeReadable(stubParams())).toBe(true);
  });
});

describe("fileRangeQueryOptions", () => {
  it("reads the window at the head sha", async () => {
    apiFetch.mockResolvedValueOnce(
      stubResponse(
        {
          path: "src/a.ts",
          ref: HEAD,
          from: 2,
          to: 3,
          lines: ["one", "two"],
          totalLines: 90,
        },
        200,
      ),
    );

    await expect(runQuery()).resolves.toMatchObject({ kind: "ready" });
    expect(apiFetch).toHaveBeenCalledWith(
      `/api/repos/repo-1/pulls/7/file-range?ref=${HEAD}&path=src%2Fa.ts&from=2&to=21`,
    );
  });

  it("reports a blob past the budget as a result, not a throw", async () => {
    apiFetch.mockResolvedValueOnce(
      stubResponse({ code: "file-too-large" }, 413),
    );

    await expect(runQuery()).resolves.toEqual({ kind: "too-large" });
  });

  it("reports a non-text blob by its code, not its status", async () => {
    apiFetch.mockResolvedValueOnce(
      stubResponse({ code: "file-not-text" }, 400),
    );

    await expect(runQuery()).resolves.toEqual({ kind: "not-text" });
  });

  it("reports a 400 this build cannot name as unavailable", async () => {
    apiFetch.mockResolvedValueOnce(
      stubResponse({ code: "invalid-request" }, 400),
    );

    await expect(runQuery()).resolves.toEqual({ kind: "unavailable" });
  });

  it("reports an upstream refusal as unavailable", async () => {
    apiFetch.mockResolvedValueOnce(
      stubResponse({ code: "github-unavailable" }, 502),
    );

    await expect(runQuery()).resolves.toEqual({ kind: "unavailable" });
  });

  it("reports a path missing at this commit as a result", async () => {
    apiFetch.mockResolvedValueOnce(
      stubResponse({ code: "file-not-found" }, 404),
    );

    await expect(runQuery()).resolves.toEqual({ kind: "not-found" });
  });

  it("throws on a slice whose lines do not fill its window", async () => {
    apiFetch.mockResolvedValueOnce(
      stubResponse(
        {
          path: "src/a.ts",
          ref: "0".repeat(40),
          from: 10,
          to: 12,
          lines: ["only", "two"],
          totalLines: 40,
        },
        200,
      ),
    );

    await expect(runQuery()).rejects.toThrow("malformed");
  });

  it("throws on a body the wire schema refuses", async () => {
    apiFetch.mockResolvedValueOnce(stubResponse({ lines: "nope" }, 200));

    await expect(runQuery()).rejects.toThrow("malformed");
  });
});
