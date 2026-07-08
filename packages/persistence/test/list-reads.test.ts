// BRIEF-19 PR 1.2 read seams (PGlite): the list endpoint's tenant query
// (`pullRequests.listForRepos` — allowed-repo filter, updated_at ordering,
// cap) and the per-PR "current span" enrichment batches
// (`briefs.latestForPullRequests`, `generation.latestBriefForPullRequests`).
// Also: `title` is persisted and refreshed by both upsert paths (a purgeable
// display label, same class as `repo_slug`).
import { describe, expect, it } from "vitest";
import {
  artifactStore,
  forTenant,
  generationProjection,
  type TenantContext,
} from "../src/lib";
import {
  GenerationKind,
  GenerationStatus,
  isInstallationId,
  isRepoId,
  PrState,
  type InstallationId,
  type RepoId,
} from "../src/types";
import { brandWith, freshDatabase } from "./helpers";

const TENANT_A: InstallationId = brandWith(isInstallationId, 1000n);
const TENANT_B: InstallationId = brandWith(isInstallationId, 2000n);
const REPO_1: RepoId = brandWith(isRepoId, 111n);
const REPO_2: RepoId = brandWith(isRepoId, 222n);
const CTX_A: TenantContext = { installationId: TENANT_A };
const CTX_B: TenantContext = { installationId: TENANT_B };

const PROVENANCE = { provider: "anthropic", model: "claude", effort: "high" };

describe("pull_request title persistence", () => {
  it("round-trips title on upsert and refreshes it on conflict", async () => {
    const handle = await freshDatabase();
    const repo = forTenant(handle, CTX_A);

    const first = await repo.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      title: "feat: initial title",
      state: PrState.OPEN,
    });
    expect(first.title).toBe("feat: initial title");

    const renamed = await repo.pullRequests.upsert({
      repoId: REPO_1,
      prNumber: 1,
      title: "feat: renamed title",
      state: PrState.OPEN,
    });
    expect(renamed.id).toBe(first.id);
    expect(renamed.title).toBe("feat: renamed title");
  });
});

describe("pull_request base_sha persistence (BRIEF-21 fold-in)", () => {
  it("persists baseSha, refreshes it when provided, preserves it when omitted", async () => {
    const handle = await freshDatabase();
    const repo = forTenant(handle, CTX_A);

    const first = await repo.pullRequests.upsert({
      repoId: REPO_1, prNumber: 1, baseSha: "base-1", state: PrState.OPEN,
    });
    expect(first.baseSha).toBe("base-1");

    // A review-event upsert (no baseSha) must NOT null the stored value.
    const preserved = await repo.pullRequests.upsert({
      repoId: REPO_1, prNumber: 1, state: PrState.OPEN,
    });
    expect(preserved.baseSha).toBe("base-1");

    // A base-branch retarget refreshes it.
    const retargeted = await repo.pullRequests.upsert({
      repoId: REPO_1, prNumber: 1, baseSha: "base-2", state: PrState.OPEN,
    });
    expect(retargeted.baseSha).toBe("base-2");
  });
});

describe("pullRequests.listForRepos", () => {
  it("returns only ctx-tenant rows in the allowed repo set, newest first, capped", async () => {
    const handle = await freshDatabase();
    const a = forTenant(handle, CTX_A);
    const b = forTenant(handle, CTX_B);

    // Tenant A: two PRs in repo 1 (distinct updated_at), one in repo 2.
    await a.pullRequests.upsert({ repoId: REPO_1, prNumber: 1, title: "a-r1-p1", state: PrState.OPEN });
    await new Promise((r) => setTimeout(r, 5));
    await a.pullRequests.upsert({ repoId: REPO_1, prNumber: 2, title: "a-r1-p2", state: PrState.OPEN });
    await a.pullRequests.upsert({ repoId: REPO_2, prNumber: 3, title: "a-r2-p3", state: PrState.OPEN });
    // Tenant B: same repo id — must NEVER surface for ctx A.
    await b.pullRequests.upsert({ repoId: REPO_1, prNumber: 9, title: "b-r1-p9", state: PrState.OPEN });

    const rows = await a.pullRequests.listForRepos([REPO_1], 100);
    expect(rows.map((row) => row.prNumber)).toEqual([2, 1]); // newest first
    expect(rows.every((row) => row.repoId === REPO_1)).toBe(true);

    const capped = await a.pullRequests.listForRepos([REPO_1, REPO_2], 2);
    expect(capped).toHaveLength(2);

    const none = await a.pullRequests.listForRepos([], 100);
    expect(none).toEqual([]);
  });
});

describe("briefs.latestForPullRequests", () => {
  it("returns the highest-index brief per PR; PRs without briefs are absent", async () => {
    const handle = await freshDatabase();
    const repo = forTenant(handle, CTX_A);
    const store = artifactStore(handle, CTX_A);
    const pr1 = await repo.pullRequests.upsert({ repoId: REPO_1, prNumber: 1, state: PrState.OPEN });
    const pr2 = await repo.pullRequests.upsert({ repoId: REPO_1, prNumber: 2, state: PrState.OPEN });

    await store.briefs.write({
      pullRequestId: pr1.id, baseSha: "base", headSha: "head-1", headIndex: 1,
      commitCount: 1, body: "{}", ...PROVENANCE,
    });
    await store.briefs.write({
      pullRequestId: pr1.id, baseSha: "base", headSha: "head-2", headIndex: 2,
      commitCount: 2, body: "{}", ...PROVENANCE,
    });

    const latest = await store.briefs.latestForPullRequests([pr1.id, pr2.id]);
    expect(latest.get(pr1.id)?.headSha).toBe("head-2");
    expect(latest.get(pr1.id)?.headIndex).toBe(2);
    expect(latest.has(pr2.id)).toBe(false);
  });

  it("never returns another tenant's briefs", async () => {
    const handle = await freshDatabase();
    const b = forTenant(handle, CTX_B);
    const bPr = await b.pullRequests.upsert({ repoId: REPO_1, prNumber: 1, state: PrState.OPEN });
    await artifactStore(handle, CTX_B).briefs.write({
      pullRequestId: bPr.id, baseSha: "base", headSha: "head", headIndex: 1,
      commitCount: 1, body: "{}", ...PROVENANCE,
    });

    const latest = await artifactStore(handle, CTX_A).briefs.latestForPullRequests([bPr.id]);
    expect(latest.size).toBe(0);
  });
});

describe("comparison existence seams (BRIEF-19 4.1)", () => {
  it("comparisonMarks.existsForSpan / revisionNarratives.existsForSpan reflect writes, lean", async () => {
    const handle = await freshDatabase();
    const repo = forTenant(handle, CTX_A);
    const store = artifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({ repoId: REPO_1, prNumber: 1, state: PrState.OPEN });
    const brief = await store.briefs.write({
      pullRequestId: pr.id, baseSha: "base", headSha: "head-2", headIndex: 2,
      commitCount: 2, body: "{}", ...PROVENANCE,
    });
    if (!brief.ok) throw new Error("brief write failed");

    expect(await store.comparisonMarks.existsForSpan(pr.id, "head-1", "head-2")).toBe(false);
    const marks = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        baselineSha: "head-1",
        headSha: "head-2",
        files: [{ file: "src/a.ts", addedRanges: [{ start: 1, end: 2 }], removedRanges: [] }],
      },
    });
    if (!marks.ok) throw new Error("marks write failed");
    expect(await store.comparisonMarks.existsForSpan(pr.id, "head-1", "head-2")).toBe(true);

    expect(await store.revisionNarratives.existsForSpan(pr.id, "head-1", "head-2")).toBe(false);
    const narrative = await store.revisionNarratives.write({
      pullRequestId: pr.id, briefId: brief.value.id, prevHeadSha: "head-1", headSha: "head-2",
      body: "{}", ...PROVENANCE,
    });
    if (!narrative.ok) throw new Error("narrative write failed");
    expect(await store.revisionNarratives.existsForSpan(pr.id, "head-1", "head-2")).toBe(true);
  });

  it("deltas.existsForSpan reflects writes, lean (BRIEF-21)", async () => {
    const handle = await freshDatabase();
    const repo = forTenant(handle, CTX_A);
    const store = artifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({ repoId: REPO_1, prNumber: 1, state: PrState.OPEN });

    expect(await store.deltas.existsForSpan(pr.id, "cp-1", "head-2")).toBe(false);
    const written = await store.deltas.write({
      pullRequestId: pr.id, baselineSha: "cp-1", headSha: "head-2", body: "{}", ...PROVENANCE,
    });
    if (!written.ok) throw new Error("delta write failed");
    expect(await store.deltas.existsForSpan(pr.id, "cp-1", "head-2")).toBe(true);
    // Span mismatch stays false — the natural key is the whole span.
    expect(await store.deltas.existsForSpan(pr.id, "cp-1", "head-3")).toBe(false);
  });

  it("never sees another tenant's marks/narratives/deltas", async () => {
    const handle = await freshDatabase();
    const b = forTenant(handle, CTX_B);
    const bStore = artifactStore(handle, CTX_B);
    const bPr = await b.pullRequests.upsert({ repoId: REPO_1, prNumber: 1, state: PrState.OPEN });
    const marks = await bStore.comparisonMarks.write({
      pullRequestId: bPr.id,
      marks: {
        baselineSha: "head-1",
        headSha: "head-2",
        files: [{ file: "src/a.ts", addedRanges: [{ start: 1, end: 2 }], removedRanges: [] }],
      },
    });
    if (!marks.ok) throw new Error("marks write failed");
    const bDelta = await bStore.deltas.write({
      pullRequestId: bPr.id, baselineSha: "head-1", headSha: "head-2", body: "{}", ...PROVENANCE,
    });
    if (!bDelta.ok) throw new Error("delta write failed");

    const aStore = artifactStore(handle, CTX_A);
    expect(await aStore.comparisonMarks.existsForSpan(bPr.id, "head-1", "head-2")).toBe(false);
    expect(await aStore.revisionNarratives.existsForSpan(bPr.id, "head-1", "head-2")).toBe(false);
    expect(await aStore.deltas.existsForSpan(bPr.id, "head-1", "head-2")).toBe(false);
  });
});

describe("batched span listings (BRIEF-24 per-revision joins)", () => {
  it("briefs.listForPullRequest carries createdAt and orders by headIndex, lean", async () => {
    const handle = await freshDatabase();
    const repo = forTenant(handle, CTX_A);
    const store = artifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({ repoId: REPO_1, prNumber: 1, state: PrState.OPEN });

    await store.briefs.write({
      pullRequestId: pr.id, baseSha: "base-2", headSha: "head-2", headIndex: 2,
      commitCount: 2, body: "{}", ...PROVENANCE,
    });
    await store.briefs.write({
      pullRequestId: pr.id, baseSha: "base-1", headSha: "head-1", headIndex: 1,
      commitCount: 1, body: "{}", ...PROVENANCE,
    });

    const rows = await store.briefs.listForPullRequest(pr.id);
    expect(rows.map((row) => row.headIndex)).toEqual([1, 2]); // ordered asc
    // baseSha is per-entry (drift fidelity) — never one shared base.
    expect(rows.map((row) => row.baseSha)).toEqual(["base-1", "base-2"]);
    for (const row of rows) {
      expect(row.createdAt).toBeInstanceOf(Date);
    }
  });

  it("marks/deltas/narratives listForPullRequest return lean SHA pairs, tenant-scoped", async () => {
    const handle = await freshDatabase();
    const repo = forTenant(handle, CTX_A);
    const store = artifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({ repoId: REPO_1, prNumber: 1, state: PrState.OPEN });
    const brief = await store.briefs.write({
      pullRequestId: pr.id, baseSha: "base", headSha: "head-2", headIndex: 2,
      commitCount: 2, body: "{}", ...PROVENANCE,
    });
    if (!brief.ok) throw new Error("brief write failed");

    await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        baselineSha: "head-1", headSha: "head-2",
        files: [{ file: "src/a.ts", addedRanges: [{ start: 1, end: 2 }], removedRanges: [] }],
      },
    });
    await store.deltas.write({
      pullRequestId: pr.id, baselineSha: "cp-1", headSha: "head-2", body: "{}", ...PROVENANCE,
    });
    await store.revisionNarratives.write({
      pullRequestId: pr.id, briefId: brief.value.id, prevHeadSha: "head-1", headSha: "head-2",
      body: "{}", ...PROVENANCE,
    });

    expect(await store.comparisonMarks.listForPullRequest(pr.id)).toEqual([
      { baselineSha: "head-1", headSha: "head-2" },
    ]);
    expect(await store.deltas.listForPullRequest(pr.id)).toEqual([
      { baselineSha: "cp-1", headSha: "head-2" },
    ]);
    expect(await store.revisionNarratives.listForPullRequest(pr.id)).toEqual([
      { prevHeadSha: "head-1", headSha: "head-2" },
    ]);

    // Another tenant sees none of these spans.
    const aStore = artifactStore(handle, CTX_B);
    expect(await aStore.comparisonMarks.listForPullRequest(pr.id)).toEqual([]);
    expect(await aStore.deltas.listForPullRequest(pr.id)).toEqual([]);
    expect(await aStore.revisionNarratives.listForPullRequest(pr.id)).toEqual([]);
  });
});

describe("generation.latestBriefForPullRequests", () => {
  it("returns the newest brief-kind projection per PR, ignoring span kinds", async () => {
    const handle = await freshDatabase();
    const repo = forTenant(handle, CTX_A);
    const gen = generationProjection(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({ repoId: REPO_1, prNumber: 1, state: PrState.OPEN });

    await gen.upsertQueued({ pullRequestId: pr.id, kind: GenerationKind.BRIEF, headSha: "head-1", baselineSha: null });
    await new Promise((r) => setTimeout(r, 5));
    await gen.upsertQueued({ pullRequestId: pr.id, kind: GenerationKind.BRIEF, headSha: "head-2", baselineSha: null });
    // A newer DELTA row must not shadow the brief-kind projection.
    await new Promise((r) => setTimeout(r, 5));
    await gen.upsertQueued({ pullRequestId: pr.id, kind: GenerationKind.DELTA, headSha: "head-2", baselineSha: "cp" });

    const latest = await gen.latestBriefForPullRequests([pr.id]);
    const row = latest.get(pr.id);
    expect(row?.kind).toBe(GenerationKind.BRIEF);
    expect(row?.headSha).toBe("head-2");
    expect(row?.status).toBe(GenerationStatus.QUEUED);
  });

  it("never returns another tenant's projections", async () => {
    const handle = await freshDatabase();
    const b = forTenant(handle, CTX_B);
    const bPr = await b.pullRequests.upsert({ repoId: REPO_1, prNumber: 1, state: PrState.OPEN });
    await generationProjection(handle, CTX_B).upsertQueued({
      pullRequestId: bPr.id, kind: GenerationKind.BRIEF, headSha: "head", baselineSha: null,
    });

    const latest = await generationProjection(handle, CTX_A).latestBriefForPullRequests([bPr.id]);
    expect(latest.size).toBe(0);
  });
});
