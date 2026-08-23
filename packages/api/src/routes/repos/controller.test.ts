import { isRepoId, type RepoId } from "persistence";
import { describe, expect, it } from "vitest";
import reposController from "./controller";

function brandRepoId(value: bigint): RepoId {
  if (!isRepoId(value)) {
    throw new Error("unbrandable repo id");
  }
  return value;
}

describe("reposController.listRepos", () => {
  it("stringifies ids and sorts by fullName ascending", () => {
    const allowed = new Map<RepoId, string>([
      [brandRepoId(2n), "acme/zeta"],
      [brandRepoId(1n), "acme/alpha"],
    ]);
    expect(reposController.listRepos(allowed)).toEqual({
      repos: [
        { repoId: "1", fullName: "acme/alpha" },
        { repoId: "2", fullName: "acme/zeta" },
      ],
    });
  });
});
