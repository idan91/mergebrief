import { describe, expect, it } from "vitest";
import { createArtifactStore, createGenerationProjection } from "persistence";
import { GenerationStatuses } from "types/generations";
import {
  RepoConfigPaths,
  repoConfigArtifactSchema,
  repoConfigOriginSchema,
} from "repo-config";
import {
  BASE,
  ctx,
  harness,
  HEAD_1,
  makeGitHub,
  makeTarget,
  makeTask,
  REPO,
  setUpHarness,
  stubGenerator,
  trigger,
} from "./helpers";

setUpHarness();

describe("generate task, repo-config origin on the generation record", () => {
  it("records config before generation so outcomes survive failed runs", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();
    // Deterministic (permanent) generation failure AFTER acquisition.
    generator.failNextWith = new Error("model refused");
    const github = makeGitHub(HEAD_1);
    github.addRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      {
        kind: "file",
        content: "version: 2\n",
        blobSha: "sha-bad",
        size: 11,
      },
    );
    const task = makeTask({ generator, github });

    await task(payload);

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.FAILED);
    const origin = repoConfigOriginSchema.parse(
      JSON.parse(row?.repoConfig ?? "null"),
    );
    const byPath = new Map(origin.files.map((file) => [file.path, file]));
    expect(byPath.get(RepoConfigPaths.SETTINGS)?.outcome).toBe("invalid");
    expect(byPath.get(RepoConfigPaths.INSTRUCTIONS)?.outcome).toBe("absent");
    // No brief artifact exists, the generation record is the only witness.
    expect(
      await createArtifactStore(harness.handle, ctx).briefs.get(
        pr.id,
        BASE,
        HEAD_1,
      ),
    ).toBeUndefined();
  });

  it("records config outcomes on both rows after successful generation", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const task = makeTask();

    await task(payload);

    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    const origin = repoConfigOriginSchema.parse(
      JSON.parse(row?.repoConfig ?? "null"),
    );
    expect(origin.files.every((file) => file.outcome === "absent")).toBe(true);
    expect(origin.collisions).toEqual([]);
    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    const artifact = repoConfigArtifactSchema.parse(
      JSON.parse(brief?.repoConfig ?? "null"),
    );
    expect(artifact.files).toEqual(origin.files);
    expect(artifact.collisions).toEqual([]);
  });
});
