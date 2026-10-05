// ArtifactStore tests (PGlite): idempotent content-addressed writes (same
// span → one row, body updated in place), cross-tenant rejection without a DB
// write, brief-anchoring for revision_narrative, and the coordinates-only Zod
// guard on comparison_marks and hunk_span.
import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  ArtifactErrorCodes,
  createTenantRepository,
  type ArtifactStore,
  type TenantContext,
} from "../src/index";
import {
  isInstallationId,
  isRepoId,
  type InstallationId,
  type RepoId,
} from "../src/types";
import { PrStates } from "types/pull-requests";
import { brandWith, freshDatabase } from "./helpers";

const TENANT_A: InstallationId = brandWith(isInstallationId, 1000n);
const TENANT_B: InstallationId = brandWith(isInstallationId, 2000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const CTX_A: TenantContext = { installationId: TENANT_A };
const CTX_B: TenantContext = { installationId: TENANT_B };

const PROV = { provider: "anthropic", model: "opus", effort: "high" } as const;

function validMarks(baselineSha: string, headSha: string) {
  return {
    baselineSha,
    headSha,
    files: [
      {
        file: "src/a.ts",
        addedRanges: [{ start: 1, end: 3 }],
        removedRanges: [],
      },
    ],
  };
}

describe("createArtifactStore.briefs idempotent content-addressed write", () => {
  it("rewrites the same span in place, one row with the body updated", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const store: ArtifactStore = createArtifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    const first = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 2,
      ...PROV,
      body: "v1",
    });
    const second = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 2,
      ...PROV,
      body: "v2-longer",
    });

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok)
      throw new Error("expected both writes to succeed");
    expect(second.value.id).toBe(first.value.id); // same row
    expect(second.value.body).toBe("v2-longer"); // updated in place
    expect(second.value.byteSize).toBe(Buffer.byteLength("v2-longer", "utf8"));

    const read = await store.briefs.get(pr.id, "base", "head");
    expect(read?.body).toBe("v2-longer");
  });

  it("round-trips the repo-config column, an omitting rewrite clears it", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const store: ArtifactStore = createArtifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 8,
      state: PrStates.OPEN,
    });

    const snapshot = JSON.stringify({
      files: [],
      collisions: [],
      policy: null,
    });
    const withConfig = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 1,
      ...PROV,
      body: "v1",
      repoConfig: snapshot,
    });
    expect(withConfig.ok).toBe(true);
    if (!withConfig.ok) throw new Error("unreachable");
    expect(withConfig.value.repoConfig).toBe(snapshot);

    // A rewrite without repoConfig clears it, the column always reflects the
    // LATEST generation of the span, never a stale earlier run's snapshot.
    const without = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 1,
      ...PROV,
      body: "v2",
    });
    expect(without.ok).toBe(true);
    if (!without.ok) throw new Error("unreachable");
    expect(without.value.repoConfig).toBeNull();
  });
});

describe("createArtifactStore.briefs unique head index per PR", () => {
  it("DB rejects a second span claiming a head index the PR already has", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const store: ArtifactStore = createArtifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 12,
      state: PrStates.OPEN,
    });
    const first = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base-old",
      headSha: "head",
      headIndex: 1,
      commitCount: 1,
      ...PROV,
      body: "v1",
    });
    expect(first.ok).toBe(true);

    await expect(
      store.briefs.write({
        pullRequestId: pr.id,
        baseSha: "base-new",
        headSha: "head",
        headIndex: 1,
        commitCount: 1,
        ...PROV,
        body: "v1",
      }),
    ).rejects.toMatchObject({
      cause: { constraint: "brief_pull_request_head_index_key" },
    });
  });
});

describe("createArtifactStore.briefs anchor origin columns", () => {
  it("round-trips anchor state + reason and updates them on rewrite", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const store: ArtifactStore = createArtifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 9,
      state: PrStates.OPEN,
    });

    const first = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 1,
      ...PROV,
      body: "v1",
      anchorState: "none",
    });
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error("unreachable");
    expect(first.value.anchorState).toBe("none");
    expect(first.value.anchorReason).toBeNull();

    const second = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 1,
      ...PROV,
      body: "v2",
      anchorState: "fresh-restart",
      anchorReason: "model-swap",
    });
    expect(second.ok).toBe(true);
    if (!second.ok) throw new Error("unreachable");
    expect(second.value.anchorState).toBe("fresh-restart");
    expect(second.value.anchorReason).toBe("model-swap");

    const read = await store.briefs.get(pr.id, "base", "head");
    expect(read?.anchorState).toBe("fresh-restart");
    expect(read?.anchorReason).toBe("model-swap");
  });

  it("stores null anchor columns when the writer omits them", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const store: ArtifactStore = createArtifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 10,
      state: PrStates.OPEN,
    });

    const written = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 1,
      ...PROV,
      body: "v1",
    });
    expect(written.ok).toBe(true);
    if (!written.ok) throw new Error("unreachable");
    expect(written.value.anchorState).toBeNull();
    expect(written.value.anchorReason).toBeNull();
  });

  it("DB CHECKs reject a bad anchor state and a reason without restart", async () => {
    const handle = await freshDatabase();
    const repo = createTenantRepository(handle, CTX_A);
    const store: ArtifactStore = createArtifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 11,
      state: PrStates.OPEN,
    });
    const base = {
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 1,
      ...PROV,
      body: "v1",
    };

    await expect(
      store.briefs.write({ ...base, anchorState: "floating" }),
    ).rejects.toThrow(/anchor/);
    await expect(
      store.briefs.write({
        ...base,
        anchorState: "anchored",
        anchorReason: "model-swap",
      }),
    ).rejects.toThrow(/anchor/);
  });
});

describe("createArtifactStore.briefs carried chunk ids", () => {
  it("stores the carried set as JSON, null when the writer omits it", async () => {
    const handle = await freshDatabase();
    const store = createArtifactStore(handle, CTX_A);
    const pr = await createTenantRepository(handle, CTX_A).pullRequests.upsert({
      repoId: REPO,
      prNumber: 11,
      state: PrStates.OPEN,
    });
    const span = {
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 1,
      ...PROV,
    };

    const legacy = await store.briefs.write({ ...span, body: "v1" });
    if (!legacy.ok) throw new Error("expected success");
    expect(legacy.value.carriedChunkIds).toBeNull();

    const carried = await store.briefs.write({
      ...span,
      body: "v2",
      anchorState: "anchored",
      carriedChunkIds: ["chunk-a", "chunk-b"],
    });
    if (!carried.ok) throw new Error("expected success");
    expect(JSON.parse(carried.value.carriedChunkIds ?? "null")).toEqual([
      "chunk-a",
      "chunk-b",
    ]);

    // A fresh restart carries nothing, an empty list rather than a null.
    const restarted = await store.briefs.write({
      ...span,
      body: "v3",
      anchorState: "fresh-restart",
      anchorReason: "model-swap",
      carriedChunkIds: [],
    });
    if (!restarted.ok) throw new Error("expected success");
    expect(restarted.value.carriedChunkIds).toBe("[]");

    // used_group_ids rides the same discipline: omitted → NULL (legacy
    // writer), present → JSON on both insert and the conflict update.
    expect(legacy.value.usedGroupIds).toBeNull();
    const used = await store.briefs.write({
      ...span,
      body: "v4",
      usedGroupIds: ["g1", "g2"],
    });
    if (!used.ok) throw new Error("expected success");
    expect(JSON.parse(used.value.usedGroupIds ?? "null")).toEqual(["g1", "g2"]);
  });
});

describe("createArtifactStore.deltas and diffSnapshots share the discipline", () => {
  it("delta: idempotent span rewrite, origin written, cross-tenant rejected", async () => {
    const handle = await freshDatabase();
    const a = createTenantRepository(handle, CTX_A);
    const aStore = createArtifactStore(handle, CTX_A);
    const bStore = createArtifactStore(handle, CTX_B);
    const pr = await a.pullRequests.upsert({
      repoId: REPO,
      prNumber: 9,
      state: PrStates.OPEN,
    });

    const first = await aStore.deltas.write({
      pullRequestId: pr.id,
      baselineSha: "chk",
      headSha: "head",
      ...PROV,
      body: "d1",
    });
    const second = await aStore.deltas.write({
      pullRequestId: pr.id,
      baselineSha: "chk",
      headSha: "head",
      ...PROV,
      body: "d2",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok)
      throw new Error("expected both writes to succeed");
    expect(second.value.id).toBe(first.value.id);
    expect(second.value.body).toBe("d2");
    expect(second.value.provider).toBe(PROV.provider);

    const foreign = await bStore.deltas.write({
      pullRequestId: pr.id,
      baselineSha: "chk",
      headSha: "head2",
      ...PROV,
      body: "x",
    });
    expect(foreign.ok).toBe(false);
    if (foreign.ok) throw new Error("expected rejection");
    expect(foreign.error.code).toBe(ArtifactErrorCodes.PARENT_NOT_IN_TENANT);
  });

  it("diff_snapshot rewrites per sha, no origin, cross-tenant rejected", async () => {
    const handle = await freshDatabase();
    const a = createTenantRepository(handle, CTX_A);
    const aStore = createArtifactStore(handle, CTX_A);
    const bStore = createArtifactStore(handle, CTX_B);
    const pr = await a.pullRequests.upsert({
      repoId: REPO,
      prNumber: 11,
      state: PrStates.OPEN,
    });

    const first = await aStore.diffSnapshots.write({
      pullRequestId: pr.id,
      sha: "chk",
      body: "s1",
    });
    const second = await aStore.diffSnapshots.write({
      pullRequestId: pr.id,
      sha: "chk",
      body: "s2",
    });
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok)
      throw new Error("expected both writes to succeed");
    expect(second.value.id).toBe(first.value.id);
    expect(second.value.body).toBe("s2");

    const foreign = await bStore.diffSnapshots.write({
      pullRequestId: pr.id,
      sha: "chk2",
      body: "x",
    });
    expect(foreign.ok).toBe(false);
    if (foreign.ok) throw new Error("expected rejection");
    expect(foreign.error.code).toBe(ArtifactErrorCodes.PARENT_NOT_IN_TENANT);

    const read = await aStore.diffSnapshots.get(pr.id, "chk");
    expect(read?.body).toBe("s2");
  });
});

describe("createArtifactStore rejects a cross-tenant write before the DB", () => {
  it("rejects a brief whose pull_request belongs to another tenant", async () => {
    const handle = await freshDatabase();
    const b = createTenantRepository(handle, CTX_B);
    const aStore = createArtifactStore(handle, CTX_A);
    const bStore = createArtifactStore(handle, CTX_B);

    const bPr = await b.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    const result = await aStore.briefs.write({
      pullRequestId: bPr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 1,
      ...PROV,
      body: "x",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error.code).toBe(ArtifactErrorCodes.PARENT_NOT_IN_TENANT);

    // No row under EITHER tenant.
    expect(await aStore.briefs.get(bPr.id, "base", "head")).toBeUndefined();
    expect(await bStore.briefs.get(bPr.id, "base", "head")).toBeUndefined();
  });
});

describe("createArtifactStore.revisionNarratives brief anchoring", () => {
  it("rejects a briefId that belongs to another PR/tenant, no row written", async () => {
    const handle = await freshDatabase();
    const a = createTenantRepository(handle, CTX_A);
    const b = createTenantRepository(handle, CTX_B);
    const aStore = createArtifactStore(handle, CTX_A);
    const bStore = createArtifactStore(handle, CTX_B);

    // A brief owned by tenant B.
    const bPr = await b.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });
    const bBrief = await bStore.briefs.write({
      pullRequestId: bPr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 1,
      ...PROV,
      body: "b-brief",
    });
    if (!bBrief.ok) throw new Error("brief write failed");

    // Tenant A owns its own PR, but points the narrative at B's brief.
    const aPr = await a.pullRequests.upsert({
      repoId: REPO,
      prNumber: 9,
      state: PrStates.OPEN,
    });
    const result = await aStore.revisionNarratives.write({
      pullRequestId: aPr.id,
      briefId: bBrief.value.id,
      prevHeadSha: "prev",
      headSha: "head",
      ...PROV,
      body: "narrative",
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error.code).toBe(ArtifactErrorCodes.BRIEF_NOT_ANCHORED);
    expect(
      await aStore.revisionNarratives.get(aPr.id, "prev", "head"),
    ).toBeUndefined();
  });

  it("accepts a narrative anchored to a brief in the same ctx and PR", async () => {
    const handle = await freshDatabase();
    const a = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const pr = await a.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });
    const brief = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 1,
      commitCount: 3,
      ...PROV,
      body: "brief",
    });
    if (!brief.ok) throw new Error("brief write failed");

    const result = await store.revisionNarratives.write({
      pullRequestId: pr.id,
      briefId: brief.value.id,
      prevHeadSha: "prev",
      headSha: "head",
      ...PROV,
      body: "narrative",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.briefId).toBe(brief.value.id);
  });
});

describe("createArtifactStore.comparisonMarks coordinates-only guard", () => {
  it("rejects a body carrying the extra key baselineLabel", async () => {
    const handle = await freshDatabase();
    const a = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const pr = await a.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    const result = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        ...validMarks("base", "head"),
        baselineLabel: "previous-brief",
        baselineIndex: 0,
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error.code).toBe(ArtifactErrorCodes.INVALID_BODY);
    expect(
      await store.comparisonMarks.get(pr.id, "base", "head"),
    ).toBeUndefined();
  });

  it("rejects a per-line content key smuggled into a range", async () => {
    const handle = await freshDatabase();
    const a = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const pr = await a.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    const result = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        baselineSha: "base",
        headSha: "head",
        files: [
          {
            file: "src/a.ts",
            addedRanges: [{ start: 1, end: 2, content: "const x = 1;" }],
            removedRanges: [],
          },
        ],
      },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error.code).toBe(ArtifactErrorCodes.INVALID_BODY);
  });

  it("rejects inverted, zero and negative line ranges", async () => {
    const handle = await freshDatabase();
    const a = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const pr = await a.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    const bodies = [
      { start: 20, end: 3 }, // inverted
      { start: 0, end: 0 }, // 0 is not a line (1-based)
      { start: -1, end: 5 }, // negative
    ];
    for (const range of bodies) {
      const result = await store.comparisonMarks.write({
        pullRequestId: pr.id,
        marks: {
          baselineSha: "base",
          headSha: "head",
          files: [
            { file: "src/a.ts", addedRanges: [range], removedRanges: [] },
          ],
        },
      });
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected rejection");
      expect(result.error.code).toBe(ArtifactErrorCodes.INVALID_BODY);
    }
  });

  it("accepts a coordinates-only body and stores it for the SHA pair", async () => {
    const handle = await freshDatabase();
    const a = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const pr = await a.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    const result = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: validMarks("base", "head"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value.baselineSha).toBe("base");
    expect(result.value.headSha).toBe("head");

    const parsedBody: unknown = JSON.parse(result.value.body);
    expect(parsedBody).toEqual(validMarks("base", "head"));

    // Idempotent rewrite of the same span → one row.
    const again = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: validMarks("base", "head"),
    });
    if (!again.ok) throw new Error("expected success");
    expect(again.value.id).toBe(result.value.id);
  });
});

describe("createArtifactStore.hunkSpans the carry-over hop", () => {
  const HOP = [
    {
      file: "src/a.ts",
      hunks: [{ oldStart: 10, oldLines: 3, newStart: 10, newLines: 5 }],
    },
  ];

  it("upserts one row per SHA pair and lists them in insertion order", async () => {
    const handle = await freshDatabase();
    const store = createArtifactStore(handle, CTX_A);
    const pr = await createTenantRepository(handle, CTX_A).pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    const first = await store.hunkSpans.write({
      pullRequestId: pr.id,
      baselineSha: "head-1",
      headSha: "head-2",
      spans: HOP,
    });
    if (!first.ok) throw new Error("expected success");
    expect(JSON.parse(first.value.spans)).toEqual(HOP);

    // Same pair rewritten in place; a later pair is a second hop.
    const rewritten = await store.hunkSpans.write({
      pullRequestId: pr.id,
      baselineSha: "head-1",
      headSha: "head-2",
      spans: [],
    });
    if (!rewritten.ok) throw new Error("expected success");
    expect(rewritten.value.id).toBe(first.value.id);
    expect(JSON.parse(rewritten.value.spans)).toEqual([]);

    await store.hunkSpans.write({
      pullRequestId: pr.id,
      baselineSha: "head-2",
      headSha: "head-3",
      spans: HOP,
    });

    // Insertion order, not chain order: a caller links the SHA pairs.
    const chain = await store.hunkSpans.listForPullRequest(pr.id);
    expect(chain.map((row) => [row.baselineSha, row.headSha])).toEqual([
      ["head-1", "head-2"],
      ["head-2", "head-3"],
    ]);
  });

  it("rejects a hunk carrying line content", async () => {
    const handle = await freshDatabase();
    const store = createArtifactStore(handle, CTX_A);
    const pr = await createTenantRepository(handle, CTX_A).pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    const result = await store.hunkSpans.write({
      pullRequestId: pr.id,
      baselineSha: "head-1",
      headSha: "head-2",
      spans: [
        {
          file: "src/a.ts",
          hunks: [
            {
              oldStart: 1,
              oldLines: 1,
              newStart: 1,
              newLines: 2,
              lines: ["+const x = 1;"],
            },
          ],
        },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error.code).toBe(ArtifactErrorCodes.INVALID_BODY);
    expect(await store.hunkSpans.listForPullRequest(pr.id)).toHaveLength(0);
  });

  it("refuses a hop on another tenant's pull request, and writes nothing", async () => {
    const handle = await freshDatabase();
    const pr = await createTenantRepository(handle, CTX_A).pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    const result = await createArtifactStore(handle, CTX_B).hunkSpans.write({
      pullRequestId: pr.id,
      baselineSha: "head-1",
      headSha: "head-2",
      spans: HOP,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error.code).toBe(ArtifactErrorCodes.PARENT_NOT_IN_TENANT);
    expect(
      await createArtifactStore(handle, CTX_A).hunkSpans.listForPullRequest(
        pr.id,
      ),
    ).toHaveLength(0);
    expect(
      await createArtifactStore(handle, CTX_B).hunkSpans.listForPullRequest(
        pr.id,
      ),
    ).toHaveLength(0);
  });
});
