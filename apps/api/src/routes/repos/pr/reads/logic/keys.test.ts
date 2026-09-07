import { describe, expect, it } from "vitest";
import { isRepoId, type RepoId } from "persistence";
import { buildDiffCacheKey, composeBriefContextBody } from "./keys";

function mintRepoId(value: bigint): RepoId {
  if (!isRepoId(value)) {
    throw new Error("not a repo id");
  }
  return value;
}

describe("buildDiffCacheKey", () => {
  it("scopes the key to session, repo, pr, and span", () => {
    const key = buildDiffCacheKey({
      sessionTokenHash: "hash",
      repoId: mintRepoId(7n),
      prNumber: 42,
      base: "a1",
      head: "b2",
    });
    expect(key).toBe("hash:7:42:a1:b2");
  });
});

describe("composeBriefContextBody", () => {
  it("wraps stored JSON verbatim", () => {
    expect(composeBriefContextBody('{"x":1}')).toBe('{"repoConfig":{"x":1}}');
  });

  it("renders null for rows without a snapshot", () => {
    expect(composeBriefContextBody(null)).toBe('{"repoConfig":null}');
  });
});
