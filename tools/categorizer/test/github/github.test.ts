import { describe, expect, it } from "vitest";
import {
  fetchCompareDiff,
  isCommentOutdated,
  isCommitish,
  metadataFromView,
  parseGhOpenPullRequests,
  normalizeReviewComment,
} from "../../src/github";

describe("metadataFromView maps gh pr view JSON to PrMetadata", () => {
  const baseView = {
    title: "t",
    body: "d",
    url: "https://github.com/o/r/pull/1",
    headRefOid: "head0000",
    baseRefOid: "base0000",
    commits: [{}],
    files: [],
  };

  it("maps gh OPEN state + isDraft to the lifecycle fields", () => {
    const meta = metadataFromView({
      ...baseView,
      state: "OPEN",
      isDraft: true,
    });
    expect(meta.state).toBe("open");
    expect(meta.draft).toBe(true);
    expect(meta.merged).toBe(false);
  });

  it("folds gh MERGED into state=closed + merged=true", () => {
    const meta = metadataFromView({
      ...baseView,
      state: "MERGED",
      isDraft: false,
    });
    expect(meta.state).toBe("closed");
    expect(meta.merged).toBe(true);
    expect(meta.draft).toBe(false);
  });

  it("maps gh CLOSED to state=closed, merged=false", () => {
    const meta = metadataFromView({ ...baseView, state: "CLOSED" });
    expect(meta.state).toBe("closed");
    expect(meta.merged).toBe(false);
  });

  it("carries headRefName as headRef and omits it when gh sends none", () => {
    expect(
      metadataFromView({ ...baseView, headRefName: "feature/thing" }).headRef,
    ).toBe("feature/thing");
    expect("headRef" in metadataFromView(baseView)).toBe(false);
  });

  it("carries baseRefName as baseRef and omits it when gh sends none", () => {
    expect(metadataFromView({ ...baseView, baseRefName: "main" }).baseRef).toBe(
      "main",
    );
    expect("baseRef" in metadataFromView(baseView)).toBe(false);
  });

  it("omits lifecycle fields when gh sends no state", () => {
    const meta = metadataFromView(baseView);
    expect("state" in meta).toBe(false);
    expect("merged" in meta).toBe(false);
    expect("draft" in meta).toBe(false);
  });

  it("omits lifecycle fields on an unknown state value", () => {
    const meta = metadataFromView({ ...baseView, state: "LOCKED" });
    expect("state" in meta).toBe(false);
    expect("merged" in meta).toBe(false);
  });
});

describe("parseGhOpenPullRequests", () => {
  const listing = { owner: "upstream", repo: "app" };

  it("maps gh list JSON onto number title refs draft and repo identity", () => {
    expect(
      parseGhOpenPullRequests(
        [
          {
            number: 12,
            title: "Bottom",
            headRefName: "feature/a",
            baseRefName: "main",
            isDraft: true,
            headRepository: { name: "app" },
            headRepositoryOwner: { login: "upstream" },
          },
        ],
        listing,
      ),
    ).toEqual({
      ok: true,
      value: [
        {
          number: 12,
          title: "Bottom",
          headRef: "feature/a",
          baseRef: "main",
          draft: true,
          headRepo: { owner: "upstream", repo: "app" },
          baseRepo: { owner: "upstream", repo: "app" },
        },
      ],
    });
  });

  it("returns a failure Result when the payload is not a list", () => {
    expect(parseGhOpenPullRequests({ number: 1 }, listing)).toEqual({
      ok: false,
      error: { reason: "invalid-shape" },
    });
  });

  it("omits a row that lacks head repository identity", () => {
    expect(
      parseGhOpenPullRequests(
        [
          {
            number: 10,
            title: "Deleted fork",
            headRefName: "main",
            baseRefName: "main",
          },
          {
            number: 11,
            title: "Kept",
            headRefName: "feature",
            baseRefName: "main",
            headRepository: { name: "app" },
            headRepositoryOwner: { login: "upstream" },
          },
        ],
        listing,
      ),
    ).toEqual({
      ok: true,
      value: [
        {
          number: 11,
          title: "Kept",
          headRef: "feature",
          baseRef: "main",
          draft: false,
          headRepo: { owner: "upstream", repo: "app" },
          baseRepo: { owner: "upstream", repo: "app" },
        },
      ],
    });
  });
});

describe("isCommitish", () => {
  it.each(["abc1234", "0123456789abcdef0123456789abcdef01234567"])(
    "accepts hex SHA %s",
    (sha) => expect(isCommitish(sha)).toBe(true),
  );
  it.each([
    "abc", // too short
    "main", // branch name
    "feat/x", // path-ish
    "../../etc", // traversal
    "0123456789abcdef0123456789abcdef012345678", // 41 chars
    "ghijklm", // non-hex
  ])("rejects %s", (sha) => expect(isCommitish(sha)).toBe(false));
});

describe("isCommentOutdated", () => {
  it("treats a line comment with a null line as outdated", () => {
    // GitHub nulls `line` when the anchor leaves the current diff.
    expect(isCommentOutdated(null, "line")).toBe(true);
    expect(isCommentOutdated(null, null)).toBe(true); // default subject = line
  });
  it("treats a line comment with a live line as current", () => {
    expect(isCommentOutdated(42, "line")).toBe(false);
  });
  it("never marks a file-level comment outdated", () => {
    expect(isCommentOutdated(null, "file")).toBe(false);
  });
});

describe("fetchCompareDiff", () => {
  // Rejects before any network call when SHAs aren't commit-ish.
  it("throws on non-SHA refs", async () => {
    await expect(
      fetchCompareDiff(
        { owner: "o", repo: "r", number: 1 },
        "main",
        "deadbeef",
      ),
    ).rejects.toThrow(/hex commit SHAs/);
  });
});

describe("normalizeReviewComment", () => {
  it("preserves GitHub range comment anchors", () => {
    expect(
      normalizeReviewComment({
        id: 101,
        path: "src/a.ts",
        start_line: 10,
        line: 12,
        original_start_line: 8,
        original_line: 10,
        subject_type: "line",
        body: "Could we cover this range?",
        user: { login: "reviewer" },
        in_reply_to_id: null,
      }),
    ).toEqual({
      id: "101",
      file: "src/a.ts",
      startLine: 10,
      line: 12,
      originalStartLine: 8,
      originalLine: 10,
      author: "reviewer",
      body: "Could we cover this range?",
      inReplyToId: null,
      outdated: false,
    });
  });
});
