import { ChunkLayoutBodySchema } from "brief-core/artifact";
import {
  countBriefChunkLayouts,
  type ChunkLayoutBody,
} from "brief-core/chunk-layout";
import {
  createArtifactStore,
  createTenantRepository,
  type ChunkLayoutRow,
  type PullRequestRowId,
} from "persistence";
import { describe, expect, it } from "vitest";
import {
  BASE,
  ctx,
  harness,
  HEAD_1,
  makeGitHub,
  makePullRequestInfo,
  makeReviewerId,
  makeTask,
  PR_REF,
  setUpHarness,
  SMALL_DIFF,
  stubGenerator,
  trigger,
} from "./helpers";

setUpHarness();

const ORPHAN_DIFF = `${SMALL_DIFF}diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -1,2 +1,3 @@
 keep
+orphan
 keep2
`;

const STUB_CHUNKS = [
  {
    id: "c1",
    file: "a.ts",
    addedRanges: [{ start: 2, end: 2 }],
    removedRanges: [],
  },
];

const DROP_SIDECARS = "DELETE FROM chunk_layout";

function readLayoutRow(
  pullRequestId: PullRequestRowId,
): Promise<ChunkLayoutRow | undefined> {
  return createArtifactStore(harness.handle, ctx).chunkLayouts.get(
    pullRequestId,
    BASE,
    HEAD_1,
  );
}

async function readLayout(
  pullRequestId: PullRequestRowId,
): Promise<ChunkLayoutBody | undefined> {
  const row = await readLayoutRow(pullRequestId);
  if (row === undefined) {
    return undefined;
  }
  return ChunkLayoutBodySchema.parse(JSON.parse(row.body));
}

describe("generate task, chunk layout sidecar", () => {
  it("stores every chunk's row counts beside the brief", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const generator = stubGenerator();

    await makeTask({ generator })(payload);

    const store = createArtifactStore(harness.handle, ctx);
    const brief = await store.briefs.get(pr.id, BASE, HEAD_1);
    const row = await readLayoutRow(pr.id);
    const body = await readLayout(pr.id);

    expect(row?.briefId).toBe(brief?.id);
    expect(body?.chunks["c1"]?.rows).toBe(4);
    expect(body?.chunks["c1"]?.hunkRows).toBe(1);
    expect(body?.chunks["c1"]?.rowRuns).toBe("h1c1a1c1e1");
    expect(body?.chunks["c1"]?.splitLineWidths).toBeUndefined();
    expect(body).toEqual(
      countBriefChunkLayouts(SMALL_DIFF, {
        chunks: STUB_CHUNKS,
        unattributed: [],
      }),
    );
  });

  it("counts an unattributed file by its path", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    const github = makeGitHub(HEAD_1);
    github.addPullRequest(PR_REF, {
      info: makePullRequestInfo(HEAD_1),
      files: [
        { path: "a.ts", additions: 1, deletions: 0 },
        { path: "b.ts", additions: 1, deletions: 0 },
      ],
      diff: ORPHAN_DIFF,
    });

    await makeTask({ generator: stubGenerator(), github })(payload);

    const body = await readLayout(pr.id);
    expect(Object.keys(body?.files ?? {})).toEqual(["b.ts"]);
    expect(body?.files["b.ts"]?.rows).toBe(4);
  });

  it("fills a missing sidecar on a run over the stored brief", async () => {
    const { pr, payload } = await trigger(HEAD_1);
    await makeTask()(payload);
    await harness.raw(DROP_SIDECARS);
    const repo = createTenantRepository(harness.handle, ctx);
    await repo.checkpoints.upsertOnSubmit({
      pullRequestId: pr.id,
      reviewerId: makeReviewerId(100n),
      lastSubmittedSha: BASE,
      submittedAt: new Date(),
    });
    const generator = stubGenerator();

    await makeTask({ generator })(payload);

    expect(generator.calls).toEqual(["delta"]);
    expect(await readLayout(pr.id)).toEqual(
      countBriefChunkLayouts(SMALL_DIFF, {
        chunks: STUB_CHUNKS,
        unattributed: [],
      }),
    );
  });
});
