import { isInstallationId, isRepoId, type RepoId } from "persistence";
import { describe, expect, it } from "vitest";
import type { AllowedRepo } from "../installation-resolver";
import reposController from "./controller";

function brandRepoId(value: bigint): RepoId {
  if (!isRepoId(value)) {
    throw new Error("unbrandable repo id");
  }
  return value;
}

describe("reposController.listRepos", () => {
  it("stringifies ids and sorts by fullName ascending", () => {
    const installationId = 10n;
    if (!isInstallationId(installationId)) throw new Error("unbrandable id");
    const allowed = new Map<RepoId, AllowedRepo>([
      [
        brandRepoId(2n),
        { installationId, fullName: "acme/zeta", viewerIsAdmin: false },
      ],
      [
        brandRepoId(1n),
        { installationId, fullName: "acme/alpha", viewerIsAdmin: true },
      ],
    ]);
    expect(reposController.listRepos(allowed)).toEqual({
      repos: [
        { repoId: "1", fullName: "acme/alpha" },
        { repoId: "2", fullName: "acme/zeta" },
      ],
    });
  });
});
