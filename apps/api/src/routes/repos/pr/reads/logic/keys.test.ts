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

  it("keys a revision span apart from the compare and by its refs", () => {
    const pair = {
      sessionTokenHash: "hash",
      repoId: mintRepoId(7n),
      prNumber: 42,
      base: "a1",
      head: "b2",
    };
    const refs = {
      prevBase: "m1",
      prevHead: "a1",
      newBase: "m1",
      newHead: "b2",
    };
    const retargeted = { ...refs, newBase: "m2" };

    const compare = buildDiffCacheKey(pair);
    const span = buildDiffCacheKey({ ...pair, refs });
    const retargetedSpan = buildDiffCacheKey({ ...pair, refs: retargeted });

    expect(new Set([compare, span, retargetedSpan]).size).toBe(3);
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
