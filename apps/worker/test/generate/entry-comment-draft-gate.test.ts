import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  createTenantRepository,
  createGenerationProjection,
} from "persistence";
import { GenerationStatuses } from "types/generations";
import type { z } from "zod/v4";
import type { GenerateRequest, Generator } from "generators";
import { RepoConfigPaths } from "repo-config";
import { FakeFailures, type FakeGitHub } from "github/testing";
import {
  BASE,
  ctx,
  harness,
  HEAD_1,
  HEAD_2,
  listCommentCalls,
  listRepoFilePaths,
  makeGitHub,
  makeRepoId,
  makeTarget,
  makeTask,
  PR_REF,
  REPO,
  setUpHarness,
  stubGenerator,
  trigger,
} from "./helpers";

setUpHarness();

describe("generate task, entry-comment draft gate", () => {
  const OPT_IN_SETTINGS = "version: 1\nentryCommentOnDrafts: true\n";
  const OPT_OUT_SETTINGS = "version: 1\nentryCommentOnDrafts: false\n";

  function optOut(github: FakeGitHub): void {
    github.addRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      {
        kind: "file",
        content: OPT_OUT_SETTINGS,
        blobSha: "sha-s",
        size: OPT_OUT_SETTINGS.length,
      },
    );
  }

  it("posts draft Entries without settings, the default is on", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    const task = makeTask({ github });

    await task(payload);

    expect(
      listCommentCalls(github).filter((call) => call === "post"),
    ).toHaveLength(2);
    expect(github.readComments(REPO).size).toBe(1);
    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(brief).toBeDefined();
  });

  it("generates drafts that opt out while suppressing both Entries", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    optOut(github);
    const task = makeTask({ github });

    await task(payload);

    expect(listCommentCalls(github)).toEqual([]);
    expect(github.readComments(REPO).size).toBe(0);
    const brief = await createArtifactStore(harness.handle, ctx).briefs.get(
      pr.id,
      BASE,
      HEAD_1,
    );
    expect(brief).toBeDefined();
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(pr, HEAD_1),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("posts draft Entries when repo settings opt in explicitly", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    github.addRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      {
        kind: "file",
        content: OPT_IN_SETTINGS,
        blobSha: "sha-s",
        size: OPT_IN_SETTINGS.length,
      },
    );
    const task = makeTask({ github });

    await task(payload);

    // generating + ready = two posts (one delete in between).
    expect(
      listCommentCalls(github).filter((call) => call === "post"),
    ).toHaveLength(2);
    expect(github.readComments(REPO).size).toBe(1);
  });

  it("posts the previously suppressed draft Entry on a ready skip drain", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    optOut(github);
    const task = makeTask({ github });
    await task(payload); // draft drain: brief stored, no comments
    expect(github.readComments(REPO).size).toBe(0);

    // ready_for_review: same head, draft flips false, brief already stored.
    github.updatePullRequest(PR_REF, { draft: false });
    const second = await trigger(HEAD_1);
    await task(second.payload);

    expect(github.readComments(REPO).size).toBe(1);
    const [body] = [...github.readComments(REPO).values()];
    expect(body).toBeTruthy();
  });

  it("posts the ready Entry when the draft flips during the run", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    optOut(github);
    const inner = stubGenerator();
    const flipping: Generator = {
      ...inner,
      async generate<S extends z.ZodType>(request: GenerateRequest<S>) {
        github.updatePullRequest(PR_REF, { draft: false });
        return inner.generate(request);
      },
    };
    const task = makeTask({ generator: flipping, github });

    await task(payload);

    expect(github.readComments(REPO).size).toBe(1);
  });

  it("lazily reads draft skip settings and posts once the opt-out lifts", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    optOut(github);
    const task = makeTask({ github });
    await task(payload); // fresh draft drain, silent
    const fetchesAfterFirst = listRepoFilePaths(github).length;

    // Re-drain (skip path) while STILL a draft: still silent, and settings
    // were (re)acquired for the gate.
    const again = await trigger(HEAD_1);
    await task(again.payload);
    expect(github.readComments(REPO).size).toBe(0);
    expect(listRepoFilePaths(github).length).toBeGreaterThan(fetchesAfterFirst);

    // Lift the opt-out and re-drain (skip path): the refresh now posts.
    github.addRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      {
        kind: "file",
        content: OPT_IN_SETTINGS,
        blobSha: "sha-s",
        size: OPT_IN_SETTINGS.length,
      },
    );
    const third = await trigger(HEAD_1);
    await task(third.payload);
    expect(github.readComments(REPO).size).toBe(1);
  });

  it("keeps draft Entry posting closed when settings fetching fails", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    github.failRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      FakeFailures.SERVER_ERROR,
    );
    const task = makeTask({ github });

    await task(payload);

    expect(github.readComments(REPO).size).toBe(0);
    const row = await createGenerationProjection(harness.handle, ctx).get(
      makeTarget(
        (await createTenantRepository(
          harness.handle,
          ctx,
        ).pullRequests.getByNumber(makeRepoId(7n), 7))!,
        HEAD_1,
      ),
    );
    expect(row?.status).toBe(GenerationStatuses.SUCCEEDED);
  });

  it("deletes lingering Entries when converting to draft under an opt-out", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const task = makeTask({ github });
    await task(payload); // non-draft: entry comment live
    expect(github.readComments(REPO).size).toBe(1);

    // Convert to draft under an opt-out, push a new head: fresh generation,
    // gate closed, the stale comment (deep-linking the OLD head) is deleted.
    optOut(github);
    github.updatePullRequest(PR_REF, { draft: true, headSha: HEAD_2 });
    const second = await trigger(HEAD_2);
    await task(second.payload);

    expect(github.readComments(REPO).size).toBe(0);
    const brief2 = await createArtifactStore(harness.handle, ctx).briefs.get(
      second.pr.id,
      BASE,
      HEAD_2,
    );
    expect(brief2).toBeDefined();
  });

  it("preserves live Entries when settings fetching fails", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.updatePullRequest(PR_REF, { draft: true });
    github.addRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      {
        kind: "file",
        content: OPT_IN_SETTINGS,
        blobSha: "sha-s",
        size: OPT_IN_SETTINGS.length,
      },
    );
    const task = makeTask({ github });
    await task(payload); // opt-in draft: comment live
    expect(github.readComments(REPO).size).toBe(1);

    // Next drain hits a 502 on settings: posting gate closes (nothing new
    // posts) but the healthy opt-in comment SURVIVES.
    github.failRepoFile(
      REPO,
      { path: RepoConfigPaths.SETTINGS },
      FakeFailures.SERVER_ERROR,
    );
    const postsBefore = listCommentCalls(github).filter(
      (call) => call === "post",
    ).length;
    const again = await trigger(HEAD_1);
    await task(again.payload);

    expect(github.readComments(REPO).size).toBe(1);
    expect(
      listCommentCalls(github).filter((call) => call === "post").length,
    ).toBe(postsBefore);
  });

  it("posts non-draft Entries without extra config reads on skips", async () => {
    const { payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    const task = makeTask({ github });
    await task(payload);
    const fetchesAfterFirst = listRepoFilePaths(github).length;
    expect(github.readComments(REPO).size).toBe(1);

    const again = await trigger(HEAD_1);
    await task(again.payload); // skip drain, non-draft: no config fetch
    expect(listRepoFilePaths(github).length).toBe(fetchesAfterFirst);
  });
});
