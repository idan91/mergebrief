// Stage 4 ArtifactStore tests (PGlite). Prove the D6 write paths: idempotent
// content-addressed writes (same span → one row, body updated in place),
// cross-tenant rejection without a DB write, the D12 brief-anchoring for
// revision_narrative, and the D13 coordinates-only Zod guard on
// comparison_marks.
import { describe, expect, it } from "vitest";
import {
  artifactStore,
  ArtifactErrorCode,
  forTenant,
  type ArtifactStore,
  type TenantContext,
} from "../src/lib.js";
import {
  isInstallationId,
  isRepoId,
  PrState,
  type InstallationId,
  type RepoId,
} from "../src/types.js";
import { brandWith, freshDatabase } from "./helpers.js";

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

describe("artifactStore.briefs — idempotent content-addressed write (D6)", () => {
  it("rewrites the same span in place — one row, body updated", async () => {
    const handle = await freshDatabase();
    const repo = forTenant(handle, CTX_A);
    const store: ArtifactStore = artifactStore(handle, CTX_A);
    const pr = await repo.pullRequests.upsert({ repoId: REPO, prNumber: 7, state: PrState.open });

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
    if (!first.ok || !second.ok) throw new Error("expected both writes to succeed");
    expect(second.value.id).toBe(first.value.id); // same row
    expect(second.value.body).toBe("v2-longer"); // updated in place
    expect(second.value.byteSize).toBe(Buffer.byteLength("v2-longer", "utf8"));

    const read = await store.briefs.get(pr.id, "base", "head");
    expect(read?.body).toBe("v2-longer");
  });
});

describe("artifactStore — cross-tenant write is rejected without a DB write", () => {
  it("rejects a brief whose pull_request belongs to another tenant", async () => {
    const handle = await freshDatabase();
    const b = forTenant(handle, CTX_B);
    const aStore = artifactStore(handle, CTX_A);
    const bStore = artifactStore(handle, CTX_B);

    const bPr = await b.pullRequests.upsert({ repoId: REPO, prNumber: 7, state: PrState.open });

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
    expect(result.error.code).toBe(ArtifactErrorCode.parentNotInTenant);

    // No row under EITHER tenant.
    expect(await aStore.briefs.get(bPr.id, "base", "head")).toBeUndefined();
    expect(await bStore.briefs.get(bPr.id, "base", "head")).toBeUndefined();
  });
});

describe("artifactStore.revisionNarratives — D12 brief anchoring", () => {
  it("rejects a briefId that belongs to another PR/tenant, no row written", async () => {
    const handle = await freshDatabase();
    const a = forTenant(handle, CTX_A);
    const b = forTenant(handle, CTX_B);
    const aStore = artifactStore(handle, CTX_A);
    const bStore = artifactStore(handle, CTX_B);

    // A brief owned by tenant B.
    const bPr = await b.pullRequests.upsert({ repoId: REPO, prNumber: 7, state: PrState.open });
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
    const aPr = await a.pullRequests.upsert({ repoId: REPO, prNumber: 9, state: PrState.open });
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
    expect(result.error.code).toBe(ArtifactErrorCode.briefNotAnchored);
    expect(await aStore.revisionNarratives.get(aPr.id, "prev", "head")).toBeUndefined();
  });

  it("accepts a narrative anchored to a brief in the same (ctx, PR)", async () => {
    const handle = await freshDatabase();
    const a = forTenant(handle, CTX_A);
    const store = artifactStore(handle, CTX_A);
    const pr = await a.pullRequests.upsert({ repoId: REPO, prNumber: 7, state: PrState.open });
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

describe("artifactStore.comparisonMarks — D13 coordinates-only guard", () => {
  it("rejects a body carrying baselineLabel (extra key)", async () => {
    const handle = await freshDatabase();
    const a = forTenant(handle, CTX_A);
    const store = artifactStore(handle, CTX_A);
    const pr = await a.pullRequests.upsert({ repoId: REPO, prNumber: 7, state: PrState.open });

    const result = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: { ...validMarks("base", "head"), baselineLabel: "previous-brief", baselineIndex: 0 },
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error.code).toBe(ArtifactErrorCode.invalidBody);
    expect(await store.comparisonMarks.get(pr.id, "base", "head")).toBeUndefined();
  });

  it("rejects a per-line content key smuggled into a range", async () => {
    const handle = await freshDatabase();
    const a = forTenant(handle, CTX_A);
    const store = artifactStore(handle, CTX_A);
    const pr = await a.pullRequests.upsert({ repoId: REPO, prNumber: 7, state: PrState.open });

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
    expect(result.error.code).toBe(ArtifactErrorCode.invalidBody);
  });

  it("accepts a valid coordinates-only body and stores exactly the SHA-pair body", async () => {
    const handle = await freshDatabase();
    const a = forTenant(handle, CTX_A);
    const store = artifactStore(handle, CTX_A);
    const pr = await a.pullRequests.upsert({ repoId: REPO, prNumber: 7, state: PrState.open });

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
