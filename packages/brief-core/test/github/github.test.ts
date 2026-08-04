import { describe, expect, it } from "vitest";
import {
  fetchCompareDiff,
  isCommentOutdated,
  isCommitish,
  isPublicUrl,
  metadataFromView,
  normalizeReviewComment,
  parsePrUrl,
} from "../../src/github";

describe("parsePrUrl", () => {
  it("parses a canonical PR URL", () => {
    expect(parsePrUrl("https://github.com/medusajs/medusa/pull/15605")).toEqual(
      {
        owner: "medusajs",
        repo: "medusa",
        number: 15605,
      },
    );
  });

  it("ignores trailing path, query, and fragment", () => {
    for (const url of [
      "https://github.com/medusajs/medusa/pull/15605/files",
      "https://github.com/medusajs/medusa/pull/15605?diff=split",
      "https://github.com/medusajs/medusa/pull/15605#issuecomment-1",
    ]) {
      expect(parsePrUrl(url).number).toBe(15605);
    }
  });

  it("accepts http and surrounding whitespace", () => {
    expect(parsePrUrl("  http://github.com/a/b/pull/7  ")).toEqual({
      owner: "a",
      repo: "b",
      number: 7,
    });
  });

  it("accepts dots, hyphens, and underscores in owner/repo", () => {
    expect(parsePrUrl("https://github.com/my-org/my.repo_x/pull/1")).toEqual({
      owner: "my-org",
      repo: "my.repo_x",
      number: 1,
    });
  });

  it.each([
    "not-a-pr-url",
    "https://github.com/owner/repo", // no /pull/<n>
    "https://github.com/owner/repo/pull/abc", // non-numeric
    "https://gitlab.com/owner/repo/pull/1", // wrong host
    "https://github.com/owner/repo/issues/1", // issue, not PR
  ])("rejects %s", (url) => {
    expect(() => parsePrUrl(url)).toThrow(/PR URL/);
  });
});

describe("metadataFromView (gh pr view JSON → PrMetadata)", () => {
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

  it("omits lifecycle fields when gh sends no state (fail-open)", () => {
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

describe("isPublicUrl (SSRF pre-filter)", () => {
  // Synchronous gate — no DNS. The authoritative check is at connect time.
  it.each([
    "http://localhost:6006/", // loopback by name
    "http://127.0.0.1/admin", // loopback IP
    "http://[::1]/", // loopback IPv6
    "http://169.254.169.254/latest/meta-data/", // cloud metadata
    "http://10.0.0.1/", // private
    "http://192.168.1.1/", // private
    "http://172.16.0.1/", // private
    "http://service.local/", // mDNS
    "ftp://example.com/", // non-http scheme
    "file:///etc/passwd", // non-http scheme
    "http://user:pass@example.com/", // embedded credentials
    "not a url", // malformed
  ])("blocks %s", (url) => {
    expect(isPublicUrl(url)).toBe(false);
  });

  it("allows a plain public URL", () => {
    expect(isPublicUrl("https://example.com/docs/a.md")).toBe(true);
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
  it("never marks a file-level comment outdated (null line by design)", () => {
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
