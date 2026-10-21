import { describe, expect, it } from "vitest";
import { isRepoId, type RepoId } from "persistence";
import { buildDiffCacheKey, buildFileBlobCacheKey } from "./keys";

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

describe("buildFileBlobCacheKey", () => {
  it("scopes the key to session, repo, ref and path", () => {
    const key = buildFileBlobCacheKey({
      sessionTokenHash: "hash",
      repoId: mintRepoId(7n),
      ref: "abc123",
      path: "src/app.ts",
    });
    expect(key).toBe("hash:7:abc123:src/app.ts");
  });
});
