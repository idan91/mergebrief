// Read boundaries (PGlite): the per-PR "current span" enrichment batches
// (`briefs.latestForPullRequests`, `generation.latestBriefForPullRequests`).
import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  createTenantRepository,
  createGenerationProjection,
  type TenantContext,
} from "../src/index";
import {
  GenerationKinds,
  isInstallationId,
  isRepoId,
  type InstallationId,
  type RepoId,
} from "../src/types";
import { GenerationStatuses } from "types/generations";
import { PrStates } from "types/pull-requests";
import {
  brandWith,
  registerSharedPglite,
  writeGenerationTriggeredAt,
} from "./helpers";
import { STORED_BODY_VERSION } from "brief-core/artifact";

const shared = registerSharedPglite();

const TENANT_A: InstallationId = brandWith(isInstallationId, 1000n);
const TENANT_B: InstallationId = brandWith(isInstallationId, 2000n);
const REPO_1: RepoId = brandWith(isRepoId, 111n);
const CTX_A: TenantContext = { installationId: TENANT_A };
const CTX_B: TenantContext = { installationId: TENANT_B };

const ORIGIN = {
  provider: "anthropic",
  model: "claude",
  effort: "high",
  bodyVersion: STORED_BODY_VERSION,
};
const OLDER = new Date("2026-01-01T00:00:00Z");
const NEWER = new Date("2026-01-01T00:01:00Z");
const NEWEST = new Date("2026-01-01T00:02:00Z");

describe("pull_request base_sha persistence", () => {
  it("persists baseSha, refreshing it only when one is provided", async () => {
    const handle = shared.handle;
    const repo = createTenantRepository(handle, CTX_A);

    const first = await repo.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      baseSha: "base-1",
      state: PrStates.OPEN,
    });
    expect(first.baseSha).toBe("base-1");

    // A review-event upsert (no baseSha) must NOT null the stored value.
    const preserved = await repo.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      state: PrStates.OPEN,
    });
    expect(preserved.baseSha).toBe("base-1");

    // A base-branch retarget refreshes it.
    const retargeted = await repo.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      baseSha: "base-2",
      state: PrStates.OPEN,
    });
    expect(retargeted.baseSha).toBe("base-2");
  });
});

describe("briefs.latestForPullRequests", () => {
  it("returns the highest-index brief per PR; PRs without briefs are absent", async () => {
    const handle = shared.handle;
    const repo = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const pr1 = await repo.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      state: PrStates.OPEN,
    });
    const pr2 = await repo.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 2,
      state: PrStates.OPEN,
    });

    await store.briefs.write({
      pullRequestId: pr1.id,
      baseSha: "base",
      headSha: "head-1",
      headIndex: 1,
      commitCount: 1,
      body: "{}",
      ...ORIGIN,
      usedGroupIds: [],
    });
    await store.briefs.write({
      pullRequestId: pr1.id,
      baseSha: "base",
      headSha: "head-2",
      headIndex: 2,
      commitCount: 2,
      body: "{}",
      ...ORIGIN,
      usedGroupIds: [],
    });

    const latest = await store.briefs.latestForPullRequests([pr1.id, pr2.id]);
    expect(latest.get(pr1.id)?.headSha).toBe("head-2");
    expect(latest.get(pr1.id)?.headIndex).toBe(2);
    expect(latest.has(pr2.id)).toBe(false);
  });

  it("never returns another tenant's briefs", async () => {
    const handle = shared.handle;
    const b = createTenantRepository(handle, CTX_B);
    const bPr = await b.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      state: PrStates.OPEN,
    });
    await createArtifactStore(handle, CTX_B).briefs.write({
      pullRequestId: bPr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 1,
      commitCount: 1,
      body: "{}",
      ...ORIGIN,
      usedGroupIds: [],
    });

    const latest = await createArtifactStore(
      handle,
      CTX_A,
    ).briefs.latestForPullRequests([bPr.id]);
    expect(latest.size).toBe(0);
  });
});

describe("comparison artifact reads", () => {
  it("never sees another tenant's marks or deltas", async () => {
    const handle = shared.handle;
    const b = createTenantRepository(handle, CTX_B);
    const bStore = createArtifactStore(handle, CTX_B);
    const bPr = await b.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      state: PrStates.OPEN,
    });
    await bStore.comparisonMarks.write({
      pullRequestId: bPr.id,
      marks: {
        baselineSha: "head-1",
        headSha: "head-2",
        files: [
          {
            file: "src/a.ts",
            addedRanges: [{ start: 1, end: 2 }],
            removedRanges: [],
          },
        ],
      },
    });
    await bStore.deltas.write({
      pullRequestId: bPr.id,
      baselineSha: "head-1",
      headSha: "head-2",
      body: "{}",
      ...ORIGIN,
    });

    const aStore = createArtifactStore(handle, CTX_A);
    expect(
      await aStore.comparisonMarks.get(bPr.id, "head-1", "head-2"),
    ).toBeUndefined();
    expect(await aStore.deltas.get(bPr.id, "head-1", "head-2")).toBeUndefined();
  });
});

describe("batched span listings and per-revision joins", () => {
  it("briefs.listForPullRequest carries createdAt and orders by headIndex", async () => {
    const handle = shared.handle;
    const repo = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      state: PrStates.OPEN,
    });

    await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base-2",
      headSha: "head-2",
      headIndex: 2,
      commitCount: 2,
      body: "{}",
      ...ORIGIN,
      usedGroupIds: [],
    });
    await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base-1",
      headSha: "head-1",
      headIndex: 1,
      commitCount: 1,
      body: "{}",
      ...ORIGIN,
      usedGroupIds: [],
    });

    const rows = await store.briefs.listForPullRequest(pr.id);
    expect(rows.map((row) => row.headIndex)).toEqual([1, 2]); // ordered asc
    // baseSha is per-entry for drift fidelity, never one shared base.
    expect(rows.map((row) => row.baseSha)).toEqual(["base-1", "base-2"]);
    for (const row of rows) {
      expect(row.createdAt).toBeInstanceOf(Date);
    }
  });

  it("the per-PR listings return lean SHA pairs, tenant-scoped", async () => {
    const handle = shared.handle;
    const repo = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      state: PrStates.OPEN,
    });
    const brief = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head-2",
      headIndex: 2,
      commitCount: 2,
      body: "{}",
      ...ORIGIN,
      usedGroupIds: [],
    });

    await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        baselineSha: "head-1",
        headSha: "head-2",
        files: [
          {
            file: "src/a.ts",
            addedRanges: [{ start: 1, end: 2 }],
            removedRanges: [],
          },
        ],
      },
    });
    await store.deltas.write({
      pullRequestId: pr.id,
      baselineSha: "cp-1",
      headSha: "head-2",
      body: "{}",
      ...ORIGIN,
    });
    await store.deltas.write({
      pullRequestId: pr.id,
      baselineSha: "cp-0",
      headSha: "head-2",
      body: JSON.stringify({ artifactKind: "deltaSkipped" }),
      ...ORIGIN,
    });
    await store.revisionNarratives.write({
      pullRequestId: pr.id,
      briefId: brief.id,
      prevHeadSha: "head-1",
      headSha: "head-2",
      body: "{}",
      ...ORIGIN,
    });

    expect(await store.comparisonMarks.listForPullRequest(pr.id)).toEqual([
      { baselineSha: "head-1", headSha: "head-2" },
    ]);
    const deltaSpans = await store.deltas.listForPullRequest(pr.id);
    expect(deltaSpans).toHaveLength(2);
    expect(deltaSpans).toEqual(
      expect.arrayContaining([
        {
          baselineSha: "cp-1",
          headSha: "head-2",
          skipped: false,
          unchanged: false,
        },
        {
          baselineSha: "cp-0",
          headSha: "head-2",
          skipped: true,
          unchanged: false,
        },
      ]),
    );
    expect(await store.revisionNarratives.listForPullRequest(pr.id)).toEqual([
      { prevHeadSha: "head-1", headSha: "head-2", unchanged: false },
    ]);

    // Another tenant sees none of these spans.
    const aStore = createArtifactStore(handle, CTX_B);
    expect(await aStore.comparisonMarks.listForPullRequest(pr.id)).toEqual([]);
    expect(await aStore.deltas.listForPullRequest(pr.id)).toEqual([]);
    expect(await aStore.revisionNarratives.listForPullRequest(pr.id)).toEqual(
      [],
    );
  });
});

describe("deltas skip record", () => {
  const SKIP_BODY = JSON.stringify({ artifactKind: "deltaSkipped" });

  it("stamps a skip record and flags it in the span listing", async () => {
    const handle = shared.handle;
    const repo = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      state: PrStates.OPEN,
    });
    const span = { pullRequestId: pr.id, baselineSha: "cp-1", ...ORIGIN };

    const skipRow = await store.deltas.write({
      ...span,
      headSha: "head-2",
      body: SKIP_BODY,
    });
    const briefRow = await store.deltas.write({
      ...span,
      headSha: "head-3",
      body: "{}",
    });

    expect(skipRow.skipped).toBe(true);
    expect(briefRow.skipped).toBe(false);
    expect(await store.deltas.listForPullRequest(pr.id)).toEqual(
      expect.arrayContaining([
        {
          baselineSha: "cp-1",
          headSha: "head-2",
          skipped: true,
          unchanged: false,
        },
        {
          baselineSha: "cp-1",
          headSha: "head-3",
          skipped: false,
          unchanged: false,
        },
      ]),
    );
  });

  it("clears the stamp when a Delta Brief rewrites the span", async () => {
    const handle = shared.handle;
    const repo = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      state: PrStates.OPEN,
    });
    const span = {
      pullRequestId: pr.id,
      baselineSha: "cp-1",
      headSha: "head-2",
      ...ORIGIN,
    };

    await store.deltas.write({ ...span, body: SKIP_BODY });
    const rewritten = await store.deltas.write({ ...span, body: "{}" });

    expect(rewritten.skipped).toBe(false);
    expect(await store.deltas.listForPullRequest(pr.id)).toEqual([
      {
        baselineSha: "cp-1",
        headSha: "head-2",
        skipped: false,
        unchanged: false,
      },
    ]);
  });
});

describe("the no-change stamp", () => {
  const UNCHANGED_DELTA = JSON.stringify({ artifactKind: "deltaUnchanged" });
  const UNCHANGED_NARRATIVE = JSON.stringify({
    artifactKind: "revisionNarrativeUnchanged",
  });

  it("stamps a delta no-change record apart from a skip record", async () => {
    const handle = shared.handle;
    const repo = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      state: PrStates.OPEN,
    });
    const span = { pullRequestId: pr.id, baselineSha: "cp-1", ...ORIGIN };

    const unchangedRow = await store.deltas.write({
      ...span,
      headSha: "head-2",
      body: UNCHANGED_DELTA,
    });
    await store.deltas.write({ ...span, headSha: "head-3", body: "{}" });

    expect(unchangedRow.unchanged).toBe(true);
    expect(unchangedRow.skipped).toBe(false);
    expect(await store.deltas.listForPullRequest(pr.id)).toEqual(
      expect.arrayContaining([
        {
          baselineSha: "cp-1",
          headSha: "head-2",
          skipped: false,
          unchanged: true,
        },
        {
          baselineSha: "cp-1",
          headSha: "head-3",
          skipped: false,
          unchanged: false,
        },
      ]),
    );
  });

  it("stamps a narrative no-change record and lists the flag", async () => {
    const handle = shared.handle;
    const repo = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      state: PrStates.OPEN,
    });
    const brief = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head-2",
      headIndex: 2,
      commitCount: 2,
      body: "{}",
      ...ORIGIN,
      usedGroupIds: [],
    });
    const span = { pullRequestId: pr.id, briefId: brief.id, ...ORIGIN };

    const unchangedRow = await store.revisionNarratives.write({
      ...span,
      prevHeadSha: "head-1",
      headSha: "head-2",
      body: UNCHANGED_NARRATIVE,
    });
    const rewritten = await store.revisionNarratives.write({
      ...span,
      prevHeadSha: "head-0",
      headSha: "head-2",
      body: UNCHANGED_NARRATIVE,
    });
    await store.revisionNarratives.write({
      ...span,
      prevHeadSha: "head-0",
      headSha: "head-2",
      body: "{}",
    });

    expect(unchangedRow.unchanged).toBe(true);
    expect(rewritten.unchanged).toBe(true);
    expect(await store.revisionNarratives.listForPullRequest(pr.id)).toEqual(
      expect.arrayContaining([
        { prevHeadSha: "head-1", headSha: "head-2", unchanged: true },
        { prevHeadSha: "head-0", headSha: "head-2", unchanged: false },
      ]),
    );
  });
});

describe("generation.latestBriefForPullRequests", () => {
  it("returns the newest brief-kind projection per PR, ignoring span kinds", async () => {
    const handle = shared.handle;
    const repo = createTenantRepository(handle, CTX_A);
    const gen = createGenerationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      state: PrStates.OPEN,
    });

    const firstBrief = {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head-1",
      baselineSha: null,
    } as const;
    const secondBrief = { ...firstBrief, headSha: "head-2" } as const;
    const delta = {
      pullRequestId: pr.id,
      kind: GenerationKinds.DELTA,
      headSha: "head-2",
      baselineSha: "cp",
    } as const;
    // Inserted newest-first so the id tiebreak alone would pick firstBrief.
    await gen.upsertPending(secondBrief);
    await gen.upsertPending(firstBrief);
    await gen.upsertPending(delta);
    await writeGenerationTriggeredAt(handle, firstBrief, OLDER);
    await writeGenerationTriggeredAt(handle, secondBrief, NEWER);
    // A newer DELTA row must not shadow the brief-kind projection.
    await writeGenerationTriggeredAt(handle, delta, NEWEST);

    const latest = await gen.latestBriefForPullRequests([pr.id]);
    const row = latest.get(pr.id);
    expect(row?.kind).toBe(GenerationKinds.BRIEF);
    expect(row?.headSha).toBe("head-2");
    expect(row?.status).toBe(GenerationStatuses.PENDING);
  });

  it("never returns another tenant's projections", async () => {
    const handle = shared.handle;
    const b = createTenantRepository(handle, CTX_B);
    const bPr = await b.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      state: PrStates.OPEN,
    });
    await createGenerationProjection(handle, CTX_B).upsertPending({
      pullRequestId: bPr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head",
      baselineSha: null,
    });

    const latest = await createGenerationProjection(
      handle,
      CTX_A,
    ).latestBriefForPullRequests([bPr.id]);
    expect(latest.size).toBe(0);
  });
});
