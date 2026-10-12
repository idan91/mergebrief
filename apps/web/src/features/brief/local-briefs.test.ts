// The local Brief reads over `/api/local-briefs`, against the bodies the API
// serves: absence and malformed sidecars degrade, broken artifacts refuse.
import { afterEach, describe, expect, it, vi } from "vitest";

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock("../../data/apiFetch", async (importOriginal) => ({
  ...(await importOriginal()),
  apiFetch,
}));

const {
  buildLocalBriefDiffsQueryOptions,
  buildLocalBriefQueryOptions,
  buildLocalBriefsQueryOptions,
  buildLocalComparisonMarksQueryOptions,
  buildLocalRevisionNarrativeQueryOptions,
} = await import("./queries");

const BRIEF_ID = "repo-7_2_bbbbbbbb";
const BRIEF_PATH = `/api/local-briefs/${BRIEF_ID}`;
const PR = {
  repo: "acme/widgets",
  number: 7,
  title: "Tighten the leak",
  url: "https://example.com/pull/7",
  sha: "b".repeat(40),
  description: "",
};
const STORED_BRIEF = {
  pr: PR,
  summary: "s",
  index: 2,
  changeGroups: [],
  chunks: [],
  concernView: [],
};
const STORED_DELTA = {
  pr: PR,
  baselineSha: "a".repeat(40),
  headSha: PR.sha,
  baselineIndex: 1,
  headIndex: null,
  generation: { provider: "anthropic", model: "m", effort: null },
  summary: "d",
  commentsAddressed: "",
  wholePrImpact: "",
  changedGroups: [],
  chunks: [],
};
const REVIEW_COMMENT = {
  id: "c1",
  file: "src/a.ts",
  startLine: null,
  line: 3,
  originalStartLine: null,
  originalLine: 3,
  author: "octocat",
  body: "why?",
  inReplyToId: null,
  outdated: false,
};
const FILES = [
  { file: "src/a.ts", addedRanges: [{ start: 1, end: 2 }], removedRanges: [] },
];

function stubText(text: string, status = 200): Response {
  return new Response(text, { status });
}

function stubJson(body: unknown, status = 200): Response {
  return stubText(JSON.stringify(body), status);
}

function stubWireError(code: string, status: number): Response {
  return stubJson({ error: code, code }, status);
}

async function runQuery(options: { queryFn?: unknown }): Promise<unknown> {
  const queryFn = options.queryFn;
  if (typeof queryFn !== "function") {
    throw new Error("no queryFn");
  }

  return queryFn({} as never);
}

afterEach(() => {
  vi.resetAllMocks();
});

describe("buildLocalBriefsQueryOptions", () => {
  it("lists the API's rows", async () => {
    const row = {
      id: BRIEF_ID,
      artifactKind: "brief",
      repo: PR.repo,
      number: PR.number,
      title: PR.title,
      sha: PR.sha,
      index: 2,
      comparisons: {
        lastReview: {
          marksId: "m1",
          baselineSha: "a",
          baselineIndex: null,
        },
      },
    };
    apiFetch.mockResolvedValueOnce(stubJson([row]));

    await expect(runQuery(buildLocalBriefsQueryOptions())).resolves.toEqual([
      row,
    ]);
    expect(apiFetch).toHaveBeenCalledWith("/api/local-briefs");
  });

  it("answers no rows when the surface is unmounted", async () => {
    apiFetch.mockResolvedValueOnce(stubText("404 Not Found", 404));

    await expect(runQuery(buildLocalBriefsQueryOptions())).resolves.toEqual([]);
  });

  it("refuses a row that breaks the listing shape", async () => {
    apiFetch.mockResolvedValueOnce(stubJson([{ id: BRIEF_ID }]));

    await expect(
      runQuery(buildLocalBriefsQueryOptions()),
    ).rejects.toMatchObject({ code: "malformed" });
  });
});

describe("buildLocalBriefQueryOptions", () => {
  it("reads a brief with its review comments", async () => {
    apiFetch.mockResolvedValueOnce(
      stubJson({
        artifactKind: "brief",
        body: STORED_BRIEF,
        reviewComments: [REVIEW_COMMENT],
      }),
    );

    const brief = await runQuery(buildLocalBriefQueryOptions(BRIEF_ID));

    expect(brief).toMatchObject({
      artifactKind: "brief",
      summary: "s",
      reviewComments: [REVIEW_COMMENT],
    });
    expect(apiFetch).toHaveBeenCalledWith(BRIEF_PATH);
  });

  it("reads a delta through the delta reader", async () => {
    apiFetch.mockResolvedValueOnce(
      stubJson({ artifactKind: "delta", body: STORED_DELTA }),
    );

    const delta = await runQuery(buildLocalBriefQueryOptions(BRIEF_ID));

    expect(delta).toMatchObject({ artifactKind: "delta", changeGroups: [] });
  });

  it("refuses the brief when its comments sidecar is invalid", async () => {
    apiFetch.mockResolvedValueOnce(
      stubJson({
        artifactKind: "brief",
        body: STORED_BRIEF,
        reviewComments: [{ id: 1 }],
      }),
    );

    await expect(
      runQuery(buildLocalBriefQueryOptions(BRIEF_ID)),
    ).rejects.toMatchObject({ code: "artifact-unreadable" });
  });

  it("refuses a body its reader rejects", async () => {
    apiFetch.mockResolvedValueOnce(
      stubJson({ artifactKind: "brief", body: { pr: PR } }),
    );

    await expect(
      runQuery(buildLocalBriefQueryOptions(BRIEF_ID)),
    ).rejects.toMatchObject({ code: "artifact-unreadable" });
  });

  it("refuses a view without a body or with an unknown kind", async () => {
    apiFetch.mockResolvedValueOnce(stubJson({ artifactKind: "brief" }));
    await expect(
      runQuery(buildLocalBriefQueryOptions(BRIEF_ID)),
    ).rejects.toMatchObject({ code: "malformed" });

    apiFetch.mockResolvedValueOnce(stubJson({ artifactKind: "x", body: {} }));
    await expect(
      runQuery(buildLocalBriefQueryOptions(BRIEF_ID)),
    ).rejects.toMatchObject({ code: "malformed" });
  });

  it("carries the wire code of a refused read", async () => {
    apiFetch.mockResolvedValueOnce(stubWireError("not-found", 404));

    await expect(
      runQuery(buildLocalBriefQueryOptions(BRIEF_ID)),
    ).rejects.toMatchObject({ code: "not-found" });
  });

  it("encodes the id into the path", async () => {
    apiFetch.mockResolvedValueOnce(stubWireError("invalid-request", 400));

    await expect(
      runQuery(buildLocalBriefQueryOptions("a/b")),
    ).rejects.toMatchObject({ code: "invalid-request" });
    expect(apiFetch).toHaveBeenCalledWith("/api/local-briefs/a%2Fb");
  });
});

describe("buildLocalBriefDiffsQueryOptions", () => {
  it("reads the per-file patches", async () => {
    const patches = [{ file: "src/a.ts", patch: "@@ -1 +1 @@\n+a" }];
    apiFetch.mockResolvedValueOnce(stubJson(patches));

    await expect(
      runQuery(buildLocalBriefDiffsQueryOptions(BRIEF_ID)),
    ).resolves.toEqual(patches);
    expect(apiFetch).toHaveBeenCalledWith(`${BRIEF_PATH}/diffs`);
  });

  it.each([
    ["missing", stubWireError("not-found", 404)],
    ["not JSON", stubText("{")],
    ["not patches", stubJson([{ file: "src/a.ts" }])],
  ])("refuses a diffs sidecar that is %s", async (_case, response) => {
    apiFetch.mockResolvedValueOnce(response);

    await expect(
      runQuery(buildLocalBriefDiffsQueryOptions(BRIEF_ID)),
    ).rejects.toMatchObject({ code: "artifact-unreadable" });
  });
});

describe("buildLocalComparisonMarksQueryOptions", () => {
  it("reads the marks sidecar", async () => {
    const marks = {
      baselineSha: "a",
      headSha: PR.sha,
      baselineLabel: "checkpoint",
      baselineIndex: null,
      files: FILES,
    };
    apiFetch.mockResolvedValueOnce(stubJson(marks));

    await expect(
      runQuery(buildLocalComparisonMarksQueryOptions("m1")),
    ).resolves.toEqual(marks);
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/local-briefs/m1/comparison-marks",
    );
  });

  it("answers no marks when the sidecar is malformed", async () => {
    apiFetch.mockResolvedValueOnce(stubJson({ baselineSha: "a" }));

    await expect(
      runQuery(buildLocalComparisonMarksQueryOptions("m1")),
    ).rejects.toThrow("sidecar missing");
  });
});

describe("buildLocalRevisionNarrativeQueryOptions", () => {
  it("answers no narrative when the sidecar is malformed", async () => {
    apiFetch.mockResolvedValueOnce(stubJson({ artifactKind: "nope" }));

    await expect(
      runQuery(buildLocalRevisionNarrativeQueryOptions("n1")),
    ).rejects.toThrow("sidecar missing");
    expect(apiFetch).toHaveBeenCalledWith(
      "/api/local-briefs/n1/revision-narrative",
    );
  });
});
