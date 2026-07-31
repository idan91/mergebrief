// The viewer-token engine (BRIEF-97): kind mapping (FORBIDDEN must fold into
// NOT_FOUND — the uniform-404 posture), metadata assembly, comment
// normalization, and the CONFIG passthrough. GitHub ops and the generation
// pipeline are mocked; the mapping logic under test is this module's own.
import { beforeEach, describe, expect, it, vi } from "vitest";

const githubMocks = vi.hoisted(() => ({
  createUserOctokit: vi.fn(() => ({ marker: "octokit" })),
  fetchPullRequest: vi.fn(),
  fetchPullRequestFiles: vi.fn(),
  fetchDiff: vi.fn(),
  fetchCompareDiff: vi.fn(),
  fetchCompareCommitCount: vi.fn(),
  fetchReviewCommentsRaw: vi.fn(),
  resolveCommitSha: vi.fn(),
}));

vi.mock("github", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...githubMocks,
}));

const generateAndWrite = vi.hoisted(() => vi.fn());
vi.mock("brief-core", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  generateAndWrite,
  lookupBriefIndex: vi.fn(async () => null),
}));

const sharedGeneratorOnce = vi.hoisted(() => vi.fn());
vi.mock("./generate.server", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  sharedGeneratorOnce,
}));

const { createUrlBriefEngine, octokitPrSource } =
  await import("./urlBriefEngine.server");
const { GeneratorConfigurationError } = await import("./generate.server");
const { GitHubApiErrorCode, createUserOctokit } = await import("github");
const { UrlBriefErrorKind } = await import("api");

// The sanctioned test-only double assertion (api.test.ts precedent): the
// source only forwards this handle to the mocked ops, never calls into it.
const octokitStub = { marker: "octokit" } as unknown as ReturnType<
  typeof createUserOctokit
>;

const LOC = { owner: "o", repo: "r", number: 7 };
const TOKEN = "ghu_viewer";

function apiError(code: string) {
  return { ok: false as const, error: { code, message: "sanitized" } };
}

const PR_INFO = {
  headSha: "h".repeat(40),
  baseSha: "b".repeat(40),
  state: "open",
  draft: false,
  title: "t",
  body: "d",
  htmlUrl: "https://github.com/o/r/pull/7",
  commitCount: 3,
};

describe("createUrlBriefEngine.fetchHeadSha", () => {
  it("returns the head sha, running as the viewer's octokit", async () => {
    githubMocks.fetchPullRequest.mockResolvedValue({
      ok: true,
      value: PR_INFO,
    });
    const result = await createUrlBriefEngine().fetchHeadSha(LOC, TOKEN);
    expect(result).toEqual({ ok: true, value: "h".repeat(40) });
    expect(githubMocks.createUserOctokit).toHaveBeenCalledWith(TOKEN);
    expect(githubMocks.fetchPullRequest).toHaveBeenCalledWith(
      { marker: "octokit" },
      { owner: "o", repo: "r", prNumber: 7 },
    );
  });

  it.each([
    [GitHubApiErrorCode.FORBIDDEN, UrlBriefErrorKind.NOT_FOUND],
    [GitHubApiErrorCode.NOT_FOUND, UrlBriefErrorKind.NOT_FOUND],
    [GitHubApiErrorCode.UNAUTHORIZED, UrlBriefErrorKind.UNAUTHORIZED],
  ])("maps GitHub %s to port kind %s", async (code, kind) => {
    githubMocks.fetchPullRequest.mockResolvedValue(apiError(code));
    const result = await createUrlBriefEngine().fetchHeadSha(LOC, TOKEN);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.kind).toBe(kind);
    // GitHub-authored text never rides the port message.
    expect(result.error.message).toBe("github fetch failed");
  });
});

describe("octokitPrSource", () => {
  it("assembles PrMetadata from the PR info + files ops", async () => {
    githubMocks.fetchPullRequest.mockResolvedValue({
      ok: true,
      value: PR_INFO,
    });
    githubMocks.fetchPullRequestFiles.mockResolvedValue({
      ok: true,
      value: [{ path: "src/a.ts", additions: 1, deletions: 2 }],
    });
    const source = octokitPrSource(octokitStub);
    await expect(source.fetchPrMetadata(LOC)).resolves.toEqual({
      title: "t",
      body: "d",
      url: "https://github.com/o/r/pull/7",
      sha: "h".repeat(40),
      baseSha: "b".repeat(40),
      commitCount: 3,
      files: [{ path: "src/a.ts", additions: 1, deletions: 2 }],
    });
  });

  it("normalizes raw review comments through brief-core's boundary parser", async () => {
    githubMocks.fetchReviewCommentsRaw.mockResolvedValue({
      ok: true,
      value: [
        {
          id: 11,
          path: "src/a.ts",
          line: 4,
          original_line: 4,
          user: { login: "reviewer" },
          body: "looks off",
          subject_type: "line",
        },
      ],
    });
    const source = octokitPrSource(octokitStub);
    const comments = await source.fetchReviewComments(LOC);
    expect(comments).toEqual([
      {
        id: "11",
        file: "src/a.ts",
        startLine: null,
        line: 4,
        originalStartLine: null,
        originalLine: 4,
        author: "reviewer",
        body: "looks off",
        inReplyToId: null,
        outdated: false,
      },
    ]);
  });

  it("caps comments at MAX_COMMENTS like the gh path (door parity)", async () => {
    const wire = Array.from({ length: 150 }, (_, i) => ({
      id: i + 1,
      path: "src/a.ts",
      line: 1,
      original_line: 1,
      user: { login: "r" },
      body: "c",
      subject_type: "line",
    }));
    githubMocks.fetchReviewCommentsRaw.mockResolvedValue({
      ok: true,
      value: wire,
    });
    const source = octokitPrSource(octokitStub);
    const comments = await source.fetchReviewComments(LOC);
    expect(comments).toHaveLength(100);
  });
});

describe("createUrlBriefEngine PAT fallback (MERGEBRIEF_URL_BOX_TOKEN)", () => {
  beforeEach(() => {
    githubMocks.fetchPullRequest.mockReset();
    githubMocks.createUserOctokit.mockClear();
  });

  it("retries a viewer-token NOT_FOUND with the operator PAT", async () => {
    vi.stubEnv("MERGEBRIEF_URL_BOX_TOKEN", "github_pat_operator");
    try {
      githubMocks.fetchPullRequest
        .mockResolvedValueOnce(apiError(GitHubApiErrorCode.NOT_FOUND))
        .mockResolvedValueOnce({ ok: true, value: PR_INFO });
      const result = await createUrlBriefEngine().fetchHeadSha(LOC, TOKEN);
      expect(result).toEqual({ ok: true, value: "h".repeat(40) });
      expect(githubMocks.createUserOctokit).toHaveBeenCalledWith(TOKEN);
      expect(githubMocks.createUserOctokit).toHaveBeenLastCalledWith(
        "github_pat_operator",
      );
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not retry when no PAT is configured — 404 stands", async () => {
    vi.stubEnv("MERGEBRIEF_URL_BOX_TOKEN", "");
    try {
      githubMocks.fetchPullRequest.mockResolvedValue(
        apiError(GitHubApiErrorCode.NOT_FOUND),
      );
      const result = await createUrlBriefEngine().fetchHeadSha(LOC, TOKEN);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.kind).toBe(UrlBriefErrorKind.NOT_FOUND);
      expect(githubMocks.fetchPullRequest).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("does not spend the PAT on an UNAUTHORIZED viewer token (session problem, not scope)", async () => {
    vi.stubEnv("MERGEBRIEF_URL_BOX_TOKEN", "github_pat_operator");
    try {
      githubMocks.fetchPullRequest.mockResolvedValue(
        apiError(GitHubApiErrorCode.UNAUTHORIZED),
      );
      const result = await createUrlBriefEngine().fetchHeadSha(LOC, TOKEN);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.error.kind).toBe(UrlBriefErrorKind.UNAUTHORIZED);
      expect(githubMocks.fetchPullRequest).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("createUrlBriefEngine.generate", () => {
  it("passes a CONFIG failure through with its env-safe message", async () => {
    sharedGeneratorOnce.mockRejectedValue(
      new GeneratorConfigurationError("ANTHROPIC_API_KEY is required"),
    );
    const result = await createUrlBriefEngine().generate(
      "https://github.com/o/r/pull/7",
      TOKEN,
    );
    expect(result).toEqual({
      ok: false,
      error: {
        kind: UrlBriefErrorKind.CONFIG,
        message: "ANTHROPIC_API_KEY is required",
      },
    });
  });

  it("runs the pipeline with the octokit source and maps the brief to a ref", async () => {
    sharedGeneratorOnce.mockResolvedValue({
      generator: { marker: "generator" },
      effort: "medium",
    });
    generateAndWrite.mockResolvedValue({
      pr: { repo: "o/r", number: 7 },
      index: 2,
      commitRange: { head: "h".repeat(40) },
    });
    const result = await createUrlBriefEngine().generate(
      "https://github.com/o/r/pull/7",
      TOKEN,
    );
    expect(result).toEqual({
      ok: true,
      value: { repo: "o/r", number: 7, index: 2, head: "h".repeat(40) },
    });
    const call = generateAndWrite.mock.calls[0];
    // (outDir, url, range, generator, log, effort, source) — source injected.
    expect(call?.[3]).toEqual({ marker: "generator" });
    expect(call?.[6]).toBeDefined();
  });
});
