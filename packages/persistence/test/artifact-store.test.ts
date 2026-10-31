// ArtifactStore tests (PGlite): idempotent content-addressed writes (same
// span → one row, body updated in place), cross-tenant rejection without a DB
// write, brief-anchoring for revision_narrative, and the coordinates-only Zod
// guard on comparison_marks and hunk_span.
import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  createTenantRepository,
  InvalidArtifactBodyError,
  ScopeViolationError,
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
import { internal } from "../src/db/handle";
import { delta as deltaTable } from "../src/schema/delta";
import { createSpanArtifactAccess } from "../src/stores/artifact-store/span-artifact";
import { resolveScope } from "../src/stores/scope";
import {
  brandWith,
  createQueryLog,
  recordStatements,
  registerSharedPglite,
} from "./helpers";
import { STORED_BODY_VERSION } from "brief-core/artifact";

const shared = registerSharedPglite();

const TENANT_A: InstallationId = brandWith(isInstallationId, 1000n);
const TENANT_B: InstallationId = brandWith(isInstallationId, 2000n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const CTX_A: TenantContext = { installationId: TENANT_A };
const CTX_B: TenantContext = { installationId: TENANT_B };

const PROV = {
  provider: "anthropic",
  model: "opus",
  effort: "high",
  bodyVersion: STORED_BODY_VERSION,
} as const;

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
    const handle = shared.handle;
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
      usedGroupIds: [],
    });
    const second = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 2,
      ...PROV,
      body: "v2-longer",
      usedGroupIds: [],
    });

    expect(second.id).toBe(first.id); // same row
    expect(second.body).toBe("v2-longer"); // updated in place
    expect(second.byteSize).toBe(Buffer.byteLength("v2-longer", "utf8"));
    expect(second).toMatchObject(PROV);

    const read = await store.briefs.get(pr.id, "base", "head");
    expect(read?.body).toBe("v2-longer");
  });

  it("reads one span's repo-config snapshot without the body", async () => {
    const handle = shared.handle;
    const repo = createTenantRepository(handle, CTX_A);
    const store: ArtifactStore = createArtifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 13,
      state: PrStates.OPEN,
    });
    const span = {
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 1,
      ...PROV,
      body: "v1",
      usedGroupIds: [],
    };

    expect(await store.briefs.getRepoConfig(pr.id, "base", "head")).toBe(
      undefined,
    );

    await store.briefs.write(span);
    expect(await store.briefs.getRepoConfig(pr.id, "base", "head")).toBeNull();

    const snapshot = JSON.stringify({
      files: [],
      collisions: [],
      policy: null,
    });
    await store.briefs.write({ ...span, repoConfig: snapshot });
    expect(await store.briefs.getRepoConfig(pr.id, "base", "head")).toBe(
      snapshot,
    );

    const other = createArtifactStore(handle, CTX_B);
    expect(await other.briefs.getRepoConfig(pr.id, "base", "head")).toBe(
      undefined,
    );
  });

  it("round-trips the repo-config column, an omitting rewrite clears it", async () => {
    const handle = shared.handle;
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
      usedGroupIds: [],
    });
    expect(withConfig.repoConfig).toBe(snapshot);

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
      usedGroupIds: [],
    });
    expect(without.repoConfig).toBeNull();
  });
});

describe("createArtifactStore.briefs unique head index per PR", () => {
  it("DB rejects a second span claiming a head index the PR already has", async () => {
    const handle = shared.handle;
    const repo = createTenantRepository(handle, CTX_A);
    const store: ArtifactStore = createArtifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 12,
      state: PrStates.OPEN,
    });
    await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base-old",
      headSha: "head",
      headIndex: 1,
      commitCount: 1,
      ...PROV,
      body: "v1",
      usedGroupIds: [],
    });

    await expect(
      store.briefs.write({
        pullRequestId: pr.id,
        baseSha: "base-new",
        headSha: "head",
        headIndex: 1,
        commitCount: 1,
        ...PROV,
        body: "v1",
        usedGroupIds: [],
      }),
    ).rejects.toMatchObject({
      cause: { constraint: "brief_pull_request_head_index_key" },
    });
  });
});

describe("createArtifactStore.briefs anchor origin columns", () => {
  it("round-trips anchor state + reason and updates them on rewrite", async () => {
    const handle = shared.handle;
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
      usedGroupIds: [],
    });
    expect(first.anchorState).toBe("none");
    expect(first.anchorReason).toBeNull();

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
      usedGroupIds: [],
    });
    expect(second.anchorState).toBe("fresh-restart");
    expect(second.anchorReason).toBe("model-swap");

    const read = await store.briefs.get(pr.id, "base", "head");
    expect(read?.anchorState).toBe("fresh-restart");
    expect(read?.anchorReason).toBe("model-swap");
  });

  it("stores null anchor columns when the writer omits them", async () => {
    const handle = shared.handle;
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
      usedGroupIds: [],
    });
    expect(written.anchorState).toBeNull();
    expect(written.anchorReason).toBeNull();
  });

  it("DB CHECKs reject a bad anchor state and a reason without restart", async () => {
    const handle = shared.handle;
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
      usedGroupIds: [],
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
  it("stores the carried set as an array, null when the writer omits it", async () => {
    const handle = shared.handle;
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
      usedGroupIds: [],
    };

    const legacy = await store.briefs.write({ ...span, body: "v1" });
    expect(legacy.carriedChunkIds).toBeNull();

    const carried = await store.briefs.write({
      ...span,
      body: "v2",
      anchorState: "anchored",
      carriedChunkIds: ["chunk-a", "chunk-b"],
    });
    expect(carried.carriedChunkIds).toEqual(["chunk-a", "chunk-b"]);

    // A fresh restart carries nothing, an empty list rather than a null.
    const restarted = await store.briefs.write({
      ...span,
      body: "v3",
      anchorState: "fresh-restart",
      anchorReason: "model-swap",
      carriedChunkIds: [],
    });
    expect(restarted.carriedChunkIds).toEqual([]);

    expect(legacy.usedGroupIds).toEqual([]);
    const used = await store.briefs.write({
      ...span,
      body: "v4",
      usedGroupIds: ["g1", "g2"],
    });
    expect(used.usedGroupIds).toEqual(["g1", "g2"]);
  });
});

describe("createArtifactStore.deltas", () => {
  it("delta: idempotent span rewrite, origin written, cross-tenant rejected", async () => {
    const handle = shared.handle;
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
    expect(second.id).toBe(first.id);
    expect(second.body).toBe("d2");
    expect(second.provider).toBe(PROV.provider);

    await expect(
      bStore.deltas.write({
        pullRequestId: pr.id,
        baselineSha: "chk",
        headSha: "head2",
        ...PROV,
        body: "x",
      }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    expect(await aStore.deltas.get(pr.id, "chk", "head2")).toBeUndefined();
    expect(await bStore.deltas.get(pr.id, "chk", "head2")).toBeUndefined();
  });
});

describe("createSpanArtifactAccess owns the stamped columns", () => {
  const DELTA_VALUES = {
    baselineSha: "chk",
    headSha: "head",
    provider: "anthropic",
    model: "opus",
    effort: "high",
    bodyVersion: STORED_BODY_VERSION,
    body: "{}",
    byteSize: 2,
  };

  it("writes under the checked parent whatever the values name", async () => {
    const handle = shared.handle;
    const repo = createTenantRepository(handle, CTX_A);
    const checked = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 1,
      state: PrStates.OPEN,
    });
    const other = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 2,
      state: PrStates.OPEN,
    });
    const access = createSpanArtifactAccess(
      internal(handle),
      resolveScope(CTX_A),
      deltaTable,
      deltaTable.baselineSha,
    );

    const row = await access.write({
      pullRequestId: checked.id,
      values: { ...DELTA_VALUES, pullRequestId: other.id },
      set: { body: "{}" },
    });

    expect(row.pullRequestId).toBe(checked.id);
  });

  it("refuses a rewrite that sets a stamped column", async () => {
    const handle = shared.handle;
    const repo = createTenantRepository(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 1,
      state: PrStates.OPEN,
    });
    const access = createSpanArtifactAccess(
      internal(handle),
      resolveScope(CTX_A),
      deltaTable,
      deltaTable.baselineSha,
    );

    expect(() =>
      access.write({
        pullRequestId: pr.id,
        values: { ...DELTA_VALUES, pullRequestId: pr.id },
        set: { pullRequestId: pr.id },
      }),
    ).toThrow("may not set pullRequestId");
  });
});

describe("createArtifactStore rejects a cross-tenant write before the DB", () => {
  it("rejects a brief whose pull_request belongs to another tenant", async () => {
    const handle = shared.handle;
    const b = createTenantRepository(handle, CTX_B);
    const aStore = createArtifactStore(handle, CTX_A);
    const bStore = createArtifactStore(handle, CTX_B);

    const bPr = await b.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    await expect(
      aStore.briefs.write({
        pullRequestId: bPr.id,
        baseSha: "base",
        headSha: "head",
        headIndex: 0,
        commitCount: 1,
        ...PROV,
        body: "x",
        usedGroupIds: [],
      }),
    ).rejects.toBeInstanceOf(ScopeViolationError);

    // No row under EITHER tenant.
    expect(await aStore.briefs.get(bPr.id, "base", "head")).toBeUndefined();
    expect(await bStore.briefs.get(bPr.id, "base", "head")).toBeUndefined();
  });
});

describe("createArtifactStore.revisionNarratives brief anchoring", () => {
  it("rejects a briefId that belongs to another PR/tenant, no row written", async () => {
    const handle = shared.handle;
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
      usedGroupIds: [],
    });

    // Tenant A owns its own PR, but points the narrative at B's brief.
    const aPr = await a.pullRequests.upsert({
      repoId: REPO,
      prNumber: 9,
      state: PrStates.OPEN,
    });
    await expect(
      aStore.revisionNarratives.write({
        pullRequestId: aPr.id,
        briefId: bBrief.id,
        prevHeadSha: "prev",
        headSha: "head",
        ...PROV,
        body: "narrative",
      }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    expect(
      await aStore.revisionNarratives.get(aPr.id, "prev", "head"),
    ).toBeUndefined();
  });

  it("accepts a narrative anchored to a brief in the same ctx and PR", async () => {
    const handle = shared.handle;
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
      usedGroupIds: [],
    });

    const result = await store.revisionNarratives.write({
      pullRequestId: pr.id,
      briefId: brief.id,
      prevHeadSha: "prev",
      headSha: "head",
      ...PROV,
      body: "narrative",
    });
    expect(result.briefId).toBe(brief.id);
    expect(result).toMatchObject(PROV);
  });

  it("rewrites the same span in place and re-points the brief anchor", async () => {
    const handle = shared.handle;
    const tenantRepo = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const pr = await tenantRepo.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });
    const briefSpan = {
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      commitCount: 1,
      ...PROV,
      body: "brief",
      usedGroupIds: [],
    };
    const firstBrief = await store.briefs.write({ ...briefSpan, headIndex: 1 });
    const secondBrief = await store.briefs.write({
      ...briefSpan,
      baseSha: "base-2",
      headIndex: 2,
    });
    const narrative = {
      pullRequestId: pr.id,
      prevHeadSha: "prev",
      headSha: "head",
      ...PROV,
      body: "n1",
    };

    const first = await store.revisionNarratives.write({
      ...narrative,
      briefId: firstBrief.id,
    });
    const second = await store.revisionNarratives.write({
      ...narrative,
      briefId: secondBrief.id,
      model: "sonnet",
      body: "n2",
    });

    expect(second.id).toBe(first.id);
    expect(second.body).toBe("n2");
    expect(second.byteSize).toBe(Buffer.byteLength("n2", "utf8"));
    expect(second.briefId).toBe(secondBrief.id);
    expect(second.model).toBe("sonnet");
    const read = await store.revisionNarratives.get(pr.id, "prev", "head");
    expect(read?.body).toBe("n2");
  });

  it("refuses a narrative on another tenant's pull request", async () => {
    const handle = shared.handle;
    const tenantBRepo = createTenantRepository(handle, CTX_B);
    const aStore = createArtifactStore(handle, CTX_A);
    const bStore = createArtifactStore(handle, CTX_B);
    const bPr = await tenantBRepo.pullRequests.upsert({
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
      usedGroupIds: [],
    });

    const bNarrative = await bStore.revisionNarratives.write({
      pullRequestId: bPr.id,
      briefId: bBrief.id,
      prevHeadSha: "prev",
      headSha: "head",
      ...PROV,
      body: "b-narrative",
    });

    const refused = aStore.revisionNarratives.write({
      pullRequestId: bPr.id,
      briefId: bBrief.id,
      prevHeadSha: "prev",
      headSha: "head-2",
      ...PROV,
      body: "narrative",
    });
    await expect(refused).rejects.toBeInstanceOf(ScopeViolationError);
    await expect(refused).rejects.toThrow(/^pull_request /);

    // Nothing under tenant A; B's own narrative is untouched and unseen by A.
    expect(await aStore.revisionNarratives.listForPullRequest(bPr.id)).toEqual(
      [],
    );
    expect(
      await aStore.revisionNarratives.get(bPr.id, "prev", "head"),
    ).toBeUndefined();
    expect(await bStore.revisionNarratives.listForPullRequest(bPr.id)).toEqual([
      { prevHeadSha: "prev", headSha: "head" },
    ]);
    const kept = await bStore.revisionNarratives.get(bPr.id, "prev", "head");
    expect(kept?.id).toBe(bNarrative.id);
  });
});

describe("createArtifactStore.comparisonMarks coordinates-only guard", () => {
  it("rejects a per-line content key smuggled into a range", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const pr = await a.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    await expect(
      store.comparisonMarks.write({
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
      }),
    ).rejects.toBeInstanceOf(InvalidArtifactBodyError);
  });

  it("rejects inverted, zero and negative line ranges", async () => {
    const handle = shared.handle;
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
      await expect(
        store.comparisonMarks.write({
          pullRequestId: pr.id,
          marks: {
            baselineSha: "base",
            headSha: "head",
            files: [
              { file: "src/a.ts", addedRanges: [range], removedRanges: [] },
            ],
          },
        }),
      ).rejects.toBeInstanceOf(InvalidArtifactBodyError);
    }
  });

  it("accepts a coordinates-only body and stores it for the SHA pair", async () => {
    const handle = shared.handle;
    const a = createTenantRepository(handle, CTX_A);
    const store = createArtifactStore(handle, CTX_A);
    const pr = await a.pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    const written = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: validMarks("base", "head"),
    });
    expect(written.baselineSha).toBe("base");
    expect(written.headSha).toBe("head");

    const parsedBody: unknown = JSON.parse(written.body);
    expect(parsedBody).toEqual(validMarks("base", "head"));
    const read = await store.comparisonMarks.get(pr.id, "base", "head");
    expect(read?.id).toBe(written.id);

    // Idempotent rewrite of the same span → one row.
    const again = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: { ...validMarks("base", "head"), files: [] },
    });
    expect(again.id).toBe(written.id);
    expect(JSON.parse(again.body)).toEqual({
      ...validMarks("base", "head"),
      files: [],
    });
  });

  it("refuses marks on another tenant's pull request, and writes nothing", async () => {
    const handle = shared.handle;
    const pr = await createTenantRepository(handle, CTX_A).pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });
    const aStore = createArtifactStore(handle, CTX_A);
    const bStore = createArtifactStore(handle, CTX_B);

    const crossTenantWrite = bStore.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: validMarks("base", "head"),
    });
    await expect(crossTenantWrite).rejects.toBeInstanceOf(ScopeViolationError);
    expect(await aStore.comparisonMarks.get(pr.id, "base", "head")).toBe(
      undefined,
    );
    expect(await bStore.comparisonMarks.get(pr.id, "base", "head")).toBe(
      undefined,
    );
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
    const handle = shared.handle;
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
    expect(JSON.parse(first.spans)).toEqual(HOP);

    // Same pair rewritten in place; a later pair is a second hop.
    const rewritten = await store.hunkSpans.write({
      pullRequestId: pr.id,
      baselineSha: "head-1",
      headSha: "head-2",
      spans: [],
    });
    expect(rewritten.id).toBe(first.id);
    expect(JSON.parse(rewritten.spans)).toEqual([]);

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
    const handle = shared.handle;
    const store = createArtifactStore(handle, CTX_A);
    const pr = await createTenantRepository(handle, CTX_A).pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });

    await expect(
      store.hunkSpans.write({
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
      }),
    ).rejects.toBeInstanceOf(InvalidArtifactBodyError);
    expect(await store.hunkSpans.listForPullRequest(pr.id)).toHaveLength(0);
  });

  it("refuses a hop on another tenant's pull request, and writes nothing", async () => {
    const handle = shared.handle;
    const pr = await createTenantRepository(handle, CTX_A).pullRequests.upsert({
      repoId: REPO,
      prNumber: 7,
      state: PrStates.OPEN,
    });
    const aStore = createArtifactStore(handle, CTX_A);
    const bStore = createArtifactStore(handle, CTX_B);
    const own = await aStore.hunkSpans.write({
      pullRequestId: pr.id,
      baselineSha: "head-0",
      headSha: "head-1",
      spans: HOP,
    });

    await expect(
      bStore.hunkSpans.write({
        pullRequestId: pr.id,
        baselineSha: "head-1",
        headSha: "head-2",
        spans: HOP,
      }),
    ).rejects.toBeInstanceOf(ScopeViolationError);

    // A keeps its one hop; B sees none of A's rows.
    const kept = await aStore.hunkSpans.listForPullRequest(pr.id);
    expect(kept.map((row) => row.id)).toEqual([own.id]);
    expect(await bStore.hunkSpans.listForPullRequest(pr.id)).toHaveLength(0);
  });
});

const NOT_NULL_VIOLATION = "23502";

async function makeOpenPullRequestStore(prNumber: number) {
  const handle = shared.handle;
  const store = createArtifactStore(handle, CTX_A);
  const pr = await createTenantRepository(handle, CTX_A).pullRequests.upsert({
    repoId: REPO,
    prNumber,
    state: PrStates.OPEN,
  });
  return { store, pr };
}

async function writeStampedArtifacts(prNumber: number, bodyVersion: number) {
  const { store, pr } = await makeOpenPullRequestStore(prNumber);
  const brief = await store.briefs.write({
    pullRequestId: pr.id,
    baseSha: "base",
    headSha: "head",
    headIndex: 0,
    commitCount: 1,
    ...PROV,
    body: "brief",
    usedGroupIds: [],
    bodyVersion,
  });
  const delta = await store.deltas.write({
    pullRequestId: pr.id,
    baselineSha: "chk",
    headSha: "head",
    ...PROV,
    body: "delta",
    bodyVersion,
  });
  const narrative = await store.revisionNarratives.write({
    pullRequestId: pr.id,
    briefId: brief.id,
    prevHeadSha: "prev",
    headSha: "head",
    ...PROV,
    body: "narrative",
    bodyVersion,
  });
  return { store, pr, brief, delta, narrative };
}

describe("createArtifactStore body version stamp", () => {
  it.each(["brief", "delta", "revision_narrative"])(
    "%s: the column refuses an unstamped row",
    async (table) => {
      const written = await writeStampedArtifacts(21, 1);
      const rowIds = {
        brief: written.brief.id,
        delta: written.delta.id,
        revision_narrative: written.narrative.id,
      };
      const rowId = rowIds[table as keyof typeof rowIds];

      await expect(
        shared.client.query(
          `update ${table} set body_version = null where id = $1`,
          [rowId.toString()],
        ),
      ).rejects.toMatchObject({ code: NOT_NULL_VIOLATION });
    },
  );

  it("a rewrite replaces each artifact's stamp", async () => {
    const { store, pr, brief } = await writeStampedArtifacts(22, 1);

    const rewritten = await writeStampedArtifacts(22, 2);

    expect(rewritten.brief.bodyVersion).toBe(2);
    expect(rewritten.delta.bodyVersion).toBe(2);
    expect(rewritten.narrative.bodyVersion).toBe(2);
    expect(rewritten.brief.id).toBe(brief.id);
    const read = await store.briefs.get(pr.id, "base", "head");
    expect(read?.bodyVersion).toBe(2);
  });

  it("a write without a stamp does not compile and is refused", async () => {
    const { store, pr } = await makeOpenPullRequestStore(23);

    await expect(
      // @ts-expect-error bodyVersion is required on every artifact write
      store.briefs.write({
        pullRequestId: pr.id,
        baseSha: "base",
        headSha: "head",
        headIndex: 0,
        commitCount: 1,
        provider: PROV.provider,
        model: PROV.model,
        effort: PROV.effort,
        body: "brief",
        usedGroupIds: [],
      }),
    ).rejects.toMatchObject({ cause: { code: NOT_NULL_VIOLATION } });
  });
});

describe("createArtifactStore.briefs session record counts", () => {
  const TWO_CHUNKS = JSON.stringify({
    changeGroups: [{ id: "g1" }],
    chunks: [
      {
        id: "c1",
        file: "src/app.ts",
        addedRanges: [{ start: 10, end: 20 }],
        riskSurface: ["sql-injection", "no-tests"],
      },
      { id: "c2", file: "src/app.ts" },
    ],
  });
  const ONE_CHUNK = JSON.stringify({
    changeGroups: [],
    chunks: [{ id: "c1", file: "src/app.ts" }],
  });

  it("stores the body's counts and recomputes them on a rewrite", async () => {
    const { store, pr } = await makeOpenPullRequestStore(24);
    const span = {
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 1,
      ...PROV,
      usedGroupIds: [],
    };

    const first = await store.briefs.write({ ...span, body: TWO_CHUNKS });
    const rewritten = await store.briefs.write({ ...span, body: ONE_CHUNK });

    expect(first).toMatchObject({
      sessionChunkCount: 2,
      sessionGroupCount: 1,
      sessionFlagCount: 2,
    });
    expect(rewritten).toMatchObject({
      sessionChunkCount: 1,
      sessionGroupCount: 0,
      sessionFlagCount: 0,
    });
  });

  it("counts unattributed files with the Chunks", async () => {
    const { store, pr } = await makeOpenPullRequestStore(26);
    const body = JSON.stringify({
      ...JSON.parse(ONE_CHUNK),
      unattributed: [{ file: "src/left.ts", addedRanges: [] }],
    });

    const written = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 1,
      ...PROV,
      body,
      usedGroupIds: [],
    });

    expect(written.sessionChunkCount).toBe(2);
  });

  it("stores no counts for a body it cannot read", async () => {
    const { store, pr } = await makeOpenPullRequestStore(25);
    const span = {
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 1,
      ...PROV,
      usedGroupIds: [],
    };
    await store.briefs.write({ ...span, body: TWO_CHUNKS });

    const unreadable = await store.briefs.write({ ...span, body: "{ no" });

    expect(unreadable).toMatchObject({
      sessionChunkCount: null,
      sessionGroupCount: null,
      sessionFlagCount: null,
    });
  });
});

describe("createArtifactStore query shape", () => {
  const PARENT_CHECK =
    'select "id" from "pull_request" where ("pull_request"."installation_id" = $1 and "pull_request"."id" = $2) limit $3';
  const BRIEF_COLUMNS =
    '"id", "installation_id", "pull_request_id", "base_sha", "head_sha", "head_index", "commit_count", "provider", "model", "effort", "repo_config", "anchor_state", "anchor_reason", "carried_chunk_ids", "used_group_ids", "body_version", "session_chunk_count", "session_group_count", "session_flag_count", "body", "byte_size", "created_at"';
  const BRIEF_UPSERT = `insert into "brief" (${BRIEF_COLUMNS}) values (default, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, default) on conflict ("installation_id","pull_request_id","base_sha","head_sha") do update set "head_index" = $21, "commit_count" = $22, "provider" = $23, "model" = $24, "effort" = $25, "repo_config" = $26, "anchor_state" = $27, "anchor_reason" = $28, "carried_chunk_ids" = $29, "used_group_ids" = $30, "body_version" = $31, "session_chunk_count" = $32, "session_group_count" = $33, "session_flag_count" = $34, "body" = $35, "byte_size" = $36 returning ${BRIEF_COLUMNS}`;
  const DELTA_COLUMNS =
    '"id", "installation_id", "pull_request_id", "baseline_sha", "head_sha", "skipped", "provider", "model", "effort", "body_version", "body", "byte_size", "created_at"';
  const DELTA_UPSERT = `insert into "delta" (${DELTA_COLUMNS}) values (default, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, default) on conflict ("installation_id","pull_request_id","baseline_sha","head_sha") do update set "skipped" = $12, "provider" = $13, "model" = $14, "effort" = $15, "body_version" = $16, "body" = $17, "byte_size" = $18 returning ${DELTA_COLUMNS}`;
  const BRIEF_ANCHOR_CHECK =
    'select "id" from "brief" where ("brief"."installation_id" = $1 and "brief"."id" = $2 and "brief"."pull_request_id" = $3) limit $4';
  const NARRATIVE_COLUMNS =
    '"id", "installation_id", "pull_request_id", "brief_id", "prev_head_sha", "head_sha", "provider", "model", "effort", "body_version", "body", "byte_size", "created_at"';
  const NARRATIVE_UPSERT = `insert into "revision_narrative" (${NARRATIVE_COLUMNS}) values (default, $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, default) on conflict ("installation_id","pull_request_id","prev_head_sha","head_sha") do update set "brief_id" = $12, "provider" = $13, "model" = $14, "effort" = $15, "body_version" = $16, "body" = $17, "byte_size" = $18 returning ${NARRATIVE_COLUMNS}`;
  const MARKS_COLUMNS =
    '"id", "installation_id", "pull_request_id", "baseline_sha", "head_sha", "body", "byte_size", "created_at"';
  const MARKS_UPSERT = `insert into "comparison_marks" (${MARKS_COLUMNS}) values (default, $1, $2, $3, $4, $5, $6, default) on conflict ("installation_id","pull_request_id","baseline_sha","head_sha") do update set "body" = $7, "byte_size" = $8 returning ${MARKS_COLUMNS}`;
  const HUNK_COLUMNS =
    '"id", "installation_id", "pull_request_id", "baseline_sha", "head_sha", "spans", "created_at"';
  const HUNK_UPSERT = `insert into "hunk_span" (${HUNK_COLUMNS}) values (default, $1, $2, $3, $4, $5, default) on conflict ("installation_id","pull_request_id","baseline_sha","head_sha") do update set "spans" = $6 returning ${HUNK_COLUMNS}`;
  const STAMPED_A = {
    status: "fulfilled",
    value: { installationId: TENANT_A },
  };

  function buildSpanWhere(table: string, lowerSha: string): string {
    return `where ("${table}"."installation_id" = $1 and "${table}"."pull_request_id" = $2 and "${table}"."${lowerSha}" = $3 and "${table}"."head_sha" = $4) limit $5`;
  }

  async function makeLoggedStore(prNumber: number) {
    const log = await createQueryLog();
    const store = createArtifactStore(log.handle, CTX_A);
    const pr = await createTenantRepository(
      log.handle,
      CTX_A,
    ).pullRequests.upsert({ repoId: REPO, prNumber, state: PrStates.OPEN });
    return { log, store, pr };
  }

  it("a brief write is one transaction: parent check, then one upsert", async () => {
    const { log, store, pr } = await makeLoggedStore(31);

    const written = await recordStatements(log, () =>
      store.briefs.write({
        pullRequestId: pr.id,
        baseSha: "base",
        headSha: "head",
        headIndex: 0,
        commitCount: 1,
        ...PROV,
        body: "{}",
        usedGroupIds: [],
      }),
    );

    expect(written.statements).toEqual([
      "begin",
      PARENT_CHECK,
      BRIEF_UPSERT,
      "commit",
    ]);
    expect(written.outcome).toMatchObject(STAMPED_A);
  });

  it("a narrative write checks the brief anchor in the same transaction", async () => {
    const { log, store, pr } = await makeLoggedStore(32);
    const brief = await store.briefs.write({
      pullRequestId: pr.id,
      baseSha: "base",
      headSha: "head",
      headIndex: 0,
      commitCount: 1,
      ...PROV,
      body: "{}",
      usedGroupIds: [],
    });

    const written = await recordStatements(log, () =>
      store.revisionNarratives.write({
        pullRequestId: pr.id,
        briefId: brief.id,
        prevHeadSha: "prev",
        headSha: "head",
        ...PROV,
        body: "{}",
      }),
    );

    expect(written.statements).toEqual([
      "begin",
      PARENT_CHECK,
      BRIEF_ANCHOR_CHECK,
      NARRATIVE_UPSERT,
      "commit",
    ]);
    expect(written.outcome).toMatchObject(STAMPED_A);
  });

  it("delta, marks and hunk-span writes upsert on their natural keys", async () => {
    const { log, store, pr } = await makeLoggedStore(33);

    const delta = await recordStatements(log, () =>
      store.deltas.write({
        pullRequestId: pr.id,
        baselineSha: "chk",
        headSha: "head",
        ...PROV,
        body: "{}",
      }),
    );
    const marks = await recordStatements(log, () =>
      store.comparisonMarks.write({
        pullRequestId: pr.id,
        marks: validMarks("prev", "head"),
      }),
    );
    const hop = await recordStatements(log, () =>
      store.hunkSpans.write({
        pullRequestId: pr.id,
        baselineSha: "prev",
        headSha: "head",
        spans: [],
      }),
    );

    expect(delta.statements).toEqual([
      "begin",
      PARENT_CHECK,
      DELTA_UPSERT,
      "commit",
    ]);
    expect(marks.statements).toEqual([
      "begin",
      PARENT_CHECK,
      MARKS_UPSERT,
      "commit",
    ]);
    expect(hop.statements).toEqual([
      "begin",
      PARENT_CHECK,
      HUNK_UPSERT,
      "commit",
    ]);
    expect(delta.outcome).toMatchObject(STAMPED_A);
    expect(marks.outcome).toMatchObject(STAMPED_A);
    expect(hop.outcome).toMatchObject(STAMPED_A);
  });

  it("a foreign parent rolls back after the parent check alone", async () => {
    const { log, pr } = await makeLoggedStore(34);
    const other = createArtifactStore(log.handle, CTX_B);

    const refused = await recordStatements(log, () =>
      other.comparisonMarks.write({
        pullRequestId: pr.id,
        marks: validMarks("prev", "head"),
      }),
    );

    expect(refused.statements).toEqual(["begin", PARENT_CHECK, "rollback"]);
    expect(refused.outcome).toMatchObject({
      status: "rejected",
      reason: expect.any(ScopeViolationError),
    });
  });

  it("a bad marks or hunk-span body is refused before any statement", async () => {
    const { log, store, pr } = await makeLoggedStore(35);

    const marks = await recordStatements(log, () =>
      store.comparisonMarks.write({
        pullRequestId: pr.id,
        marks: { ...validMarks("prev", "head"), baselineLabel: "x" },
      }),
    );
    const hop = await recordStatements(log, () =>
      store.hunkSpans.write({
        pullRequestId: pr.id,
        baselineSha: "prev",
        headSha: "head",
        spans: [{ file: "a", hunks: [], lines: [] }],
      }),
    );

    expect(marks.statements).toEqual([]);
    expect(hop.statements).toEqual([]);
    expect(marks.outcome).toMatchObject({
      status: "rejected",
      reason: expect.any(InvalidArtifactBodyError),
    });
    expect(hop.outcome).toMatchObject({
      status: "rejected",
      reason: expect.any(InvalidArtifactBodyError),
    });
  });

  it("the span reads select the natural key under the scope filter", async () => {
    const { log, store, pr } = await makeLoggedStore(36);

    const brief = await recordStatements(log, () =>
      store.briefs.get(pr.id, "base", "head"),
    );
    const repoConfig = await recordStatements(log, () =>
      store.briefs.getRepoConfig(pr.id, "base", "head"),
    );
    const delta = await recordStatements(log, () =>
      store.deltas.get(pr.id, "chk", "head"),
    );
    const narrative = await recordStatements(log, () =>
      store.revisionNarratives.get(pr.id, "prev", "head"),
    );
    const marks = await recordStatements(log, () =>
      store.comparisonMarks.get(pr.id, "prev", "head"),
    );

    expect(brief.statements).toEqual([
      `select ${BRIEF_COLUMNS} from "brief" ${buildSpanWhere("brief", "base_sha")}`,
    ]);
    expect(repoConfig.statements).toEqual([
      `select "repo_config" from "brief" ${buildSpanWhere("brief", "base_sha")}`,
    ]);
    expect(delta.statements).toEqual([
      `select ${DELTA_COLUMNS} from "delta" ${buildSpanWhere("delta", "baseline_sha")}`,
    ]);
    expect(narrative.statements).toEqual([
      `select ${NARRATIVE_COLUMNS} from "revision_narrative" ${buildSpanWhere("revision_narrative", "prev_head_sha")}`,
    ]);
    expect(marks.statements).toEqual([
      `select ${MARKS_COLUMNS} from "comparison_marks" ${buildSpanWhere("comparison_marks", "baseline_sha")}`,
    ]);
  });

  it("each listing selects its span columns only, in its own order", async () => {
    const { log, store, pr } = await makeLoggedStore(37);

    const briefs = await recordStatements(log, () =>
      store.briefs.listForPullRequest(pr.id),
    );
    const deltas = await recordStatements(log, () =>
      store.deltas.listForPullRequest(pr.id),
    );
    const narratives = await recordStatements(log, () =>
      store.revisionNarratives.listForPullRequest(pr.id),
    );
    const marks = await recordStatements(log, () =>
      store.comparisonMarks.listForPullRequest(pr.id),
    );
    const hops = await recordStatements(log, () =>
      store.hunkSpans.listForPullRequest(pr.id),
    );

    expect(briefs.statements).toEqual([
      'select "id", "base_sha", "head_sha", "head_index", "created_at" from "brief" where ("brief"."installation_id" = $1 and "brief"."pull_request_id" = $2) order by "brief"."head_index"',
    ]);
    expect(deltas.statements).toEqual([
      'select "baseline_sha", "head_sha", "skipped" from "delta" where ("delta"."installation_id" = $1 and "delta"."pull_request_id" = $2)',
    ]);
    expect(narratives.statements).toEqual([
      'select "prev_head_sha", "head_sha" from "revision_narrative" where ("revision_narrative"."installation_id" = $1 and "revision_narrative"."pull_request_id" = $2)',
    ]);
    expect(marks.statements).toEqual([
      'select "baseline_sha", "head_sha" from "comparison_marks" where ("comparison_marks"."installation_id" = $1 and "comparison_marks"."pull_request_id" = $2)',
    ]);
    expect(hops.statements).toEqual([
      `select ${HUNK_COLUMNS} from "hunk_span" where ("hunk_span"."installation_id" = $1 and "hunk_span"."pull_request_id" = $2) order by "hunk_span"."id" asc`,
    ]);
  });
});
