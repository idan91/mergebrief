// generateAndWrite honors an INJECTED PrSource: a front door with no gh binary
// supplies its own transport. The barrel's gh functions are mocked to throw, so
// any accidental fall-through to the default is a loud failure.
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { z } from "zod/v4";
import type { GenerateRequest, Generator } from "generators";
import type * as ContextModule from "../../src/context";
import type * as GithubModule from "../../src/github";
import type { PrMetadata, PrSource, ReviewComment } from "../../src/github";
import type { Effort, Generation } from "../../src/types";

const explode = vi.hoisted(
  () => (name: string) =>
    vi.fn(async () => {
      throw new Error(`default gh path reached: ${name}`);
    }),
);

vi.mock("../../src/github", async (importOriginal) => {
  const actual = await importOriginal<typeof GithubModule>();
  const exploding = {
    fetchPrMetadata: explode("fetchPrMetadata"),
    fetchPrDiff: explode("fetchPrDiff"),
    fetchCompareDiff: explode("fetchCompareDiff"),
    fetchCompareCommitCount: explode("fetchCompareCommitCount"),
    fetchReviewComments: explode("fetchReviewComments"),
    resolveFullSha: explode("resolveFullSha"),
  };
  return {
    ...actual,
    ...exploding,
    ghPrSource: { ...actual.ghPrSource, ...exploding },
  };
});
// Not part of the port (its own boundary): must be quiet, not exploding.
vi.mock("../../src/context", async (importOriginal) => {
  const actual = await importOriginal<typeof ContextModule>();
  return {
    ...actual,
    fetchContextSnippets: vi.fn(async () => ({ links: [] })),
  };
});

const { generateAndWrite } = await import("../../src/cli/categorize");

const URL = "https://github.com/o/r/pull/7";
const HEAD = "aaaa111100000000";

const meta: PrMetadata = {
  title: "t",
  body: "d",
  url: URL,
  sha: HEAD,
  baseSha: "base000000000000",
  commitCount: 2,
  files: [{ path: "src/a.ts", additions: 1, deletions: 0 }],
};

const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,2 @@
 ctx
+l1
`;

const comment: ReviewComment = {
  id: "rc-1",
  file: "src/a.ts",
  startLine: null,
  line: 2,
  originalStartLine: null,
  originalLine: 2,
  author: "reviewer",
  body: "from the injected source",
  inReplyToId: null,
  outdated: false,
};

/** Minimal generation fixture parsed through the request's own schema. */
const briefGen = {
  summary: "s",
  intentCheck: {
    ticketUrls: [],
    ticketTitles: [],
    specificity: "none",
    scopeNote: "",
    items: [],
    alignment: { read: "", goal: "", response: "" },
  },
  changeGroups: [
    {
      id: "g1",
      title: "g title",
      summary: "g",
      dominantCategory: "new-feature",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [
    {
      id: "c1",
      changeGroupId: "g1",
      file: "src/a.ts",
      concern: "implementation",
      role: "core",
      loc: { added: 1, deleted: 0 },
      addedRanges: [{ start: 2, end: 2 }],
      removedRanges: [],
      riskSurface: [],
    },
  ],
  concernView: [{ concern: "implementation", added: 1, deleted: 0 }],
};

class FakeGenerator implements Generator {
  origin(effort: Effort): Generation {
    return { provider: "fake", model: "fake-model", effort };
  }
  async generate<S extends z.ZodType>(
    req: GenerateRequest<S>,
  ): Promise<z.infer<S>> {
    if (req.label !== "brief") throw new Error(`unexpected label ${req.label}`);
    return req.schema.parse(briefGen);
  }
}

function fakeSource(): PrSource {
  return {
    fetchPrMetadata: vi.fn(async () => meta),
    fetchPrDiff: vi.fn(async () => diff),
    fetchCompareDiff: vi.fn(async () => ""),
    fetchReviewComments: vi.fn(async () => [comment]),
    fetchCompareCommitCount: vi.fn(async () => 1),
    resolveFullSha: vi.fn(async (_loc, ref) => ref),
  };
}

describe("generateAndWrite with an injected PrSource", () => {
  let outDir: string;

  beforeEach(async () => {
    outDir = await mkdtemp(join(tmpdir(), "brief-core-source-"));
  });
  afterEach(async () => {
    await rm(outDir, { recursive: true, force: true });
  });

  it("builds every artifact from the injected source, never gh", async () => {
    const source = fakeSource();
    const brief = await generateAndWrite(
      outDir,
      URL,
      undefined,
      new FakeGenerator(),
      () => {},
      undefined,
      source,
    );

    expect(brief.pr).toMatchObject({ repo: "o/r", number: 7, sha: HEAD });
    expect(source.fetchPrMetadata).toHaveBeenCalledTimes(1);
    expect(source.fetchPrDiff).toHaveBeenCalledTimes(1);
    expect(source.fetchReviewComments).toHaveBeenCalledTimes(1);
    // Full-brief path: no range, first brief — compare machinery untouched.
    expect(source.fetchCompareDiff).not.toHaveBeenCalled();
    expect(source.resolveFullSha).not.toHaveBeenCalled();

    const files = { brief: "", comments: "" };
    files.comments = await readFile(
      join(outDir, "o-r-7_1_aaaa1111.comments.json"),
      "utf8",
    );
    files.brief = await readFile(
      join(outDir, "o-r-7_1_aaaa1111.brief.json"),
      "utf8",
    );
    expect(JSON.parse(files.comments)).toEqual([comment]);
    expect(JSON.parse(files.brief)).toMatchObject({
      commitRange: { head: HEAD, commitCount: 2 },
    });
  });
});
