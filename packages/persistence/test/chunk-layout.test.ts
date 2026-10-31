// ChunkLayoutStore tests (PGlite): one sidecar per brief, replaced with the
// brief, backfilled only where missing, counts only, and both scope worlds
// keep their sidecars to themselves.
import { STORED_BODY_VERSION } from "brief-core/artifact";
import { PrStates } from "types/pull-requests";
import type { Mutable } from "types/utils";
import { describe, expect, it } from "vitest";
import { internal } from "../src/db/handle";
import { chunkLayout as chunkLayoutTable } from "../src/schema/chunk-layout";
import {
  createArtifactStore,
  createPurgeRoutines,
  createTenantRepository,
  InvalidArtifactBodyError,
  ScopeViolationError,
  type ArtifactStore,
  type BriefRowId,
  type BriefWriteInput,
  type OwnerContext,
  type PullRequestRowId,
  type TenantContext,
} from "../src/index";
import {
  isInstallationId,
  isRepoId,
  isReviewerId,
  type InstallationId,
  type RepoId,
  type ReviewerId,
} from "../src/types";
import { brandWith, registerSharedPglite } from "./helpers";

const shared = registerSharedPglite();

const TENANT_A: InstallationId = brandWith(isInstallationId, 1000n);
const TENANT_B: InstallationId = brandWith(isInstallationId, 2000n);
const OWNER_A: ReviewerId = brandWith(isReviewerId, 501n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const CTX_A: TenantContext = { installationId: TENANT_A };
const CTX_B: TenantContext = { installationId: TENANT_B };
const OWNER_CTX_A: OwnerContext = { ownerUserId: OWNER_A };

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const OTHER_HEAD = "c".repeat(40);

const COUNTS = {
  rows: 7,
  hunkRows: 1,
  expandRows: 1,
  splitRows: 6,
  lineWidths: { counts: [3, 2, 0, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
};

const LAYOUT = { chunks: { c1: COUNTS }, files: { "src/orphan.ts": COUNTS } };

async function openPullRequest(ctx: TenantContext | OwnerContext) {
  const repo = createTenantRepository(shared.handle, ctx);
  return repo.pullRequests.upsert({
    repoId: REPO,
    prNumber: 7,
    repoSlug: "acme/widgets",
    state: PrStates.OPEN,
  });
}

interface BriefFixture {
  readonly headSha: string;
  readonly headIndex: number;
  readonly chunkLayout?: unknown;
}

async function writeBrief(
  store: ArtifactStore,
  pullRequestId: PullRequestRowId,
  fixture: BriefFixture,
): Promise<BriefRowId> {
  const write: Mutable<BriefWriteInput> = {
    pullRequestId,
    baseSha: BASE,
    headSha: fixture.headSha,
    headIndex: fixture.headIndex,
    commitCount: 1,
    provider: "anthropic",
    model: "opus",
    effort: "high",
    bodyVersion: STORED_BODY_VERSION,
    body: "{}",
    usedGroupIds: [],
  };
  if (fixture.chunkLayout !== undefined) {
    write.chunkLayout = fixture.chunkLayout;
  }
  const written = await store.briefs.write(write);
  return written.id;
}

function readBody(row: { body: string } | undefined): unknown {
  return JSON.parse(row?.body ?? "null");
}

describe("createArtifactStore.briefs.has", () => {
  it("says whether a brief covers the span, in scope only", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = createArtifactStore(shared.handle, CTX_A);
    await writeBrief(store, pr.id, { headSha: HEAD, headIndex: 1 });

    expect(await store.briefs.has(pr.id, BASE, HEAD)).toBe(true);
    expect(await store.briefs.has(pr.id, BASE, OTHER_HEAD)).toBe(false);
    const otherTenant = createArtifactStore(shared.handle, CTX_B);
    expect(await otherTenant.briefs.has(pr.id, BASE, HEAD)).toBe(false);
  });
});

describe("createArtifactStore.chunkLayouts", () => {
  it("stores the sidecar with the brief and reads it through its span", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = createArtifactStore(shared.handle, CTX_A);
    const briefId = await writeBrief(store, pr.id, {
      headSha: HEAD,
      headIndex: 1,
      chunkLayout: LAYOUT,
    });

    const read = await store.chunkLayouts.get(pr.id, BASE, HEAD);

    expect(read?.briefId).toBe(briefId);
    expect(readBody(read)).toEqual(LAYOUT);
    expect(read?.byteSize).toBe(Buffer.byteLength(read?.body ?? "", "utf8"));
  });

  it("replaces the sidecar when the brief is rewritten", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = createArtifactStore(shared.handle, CTX_A);
    const next = { chunks: { c2: COUNTS }, files: {} };
    await writeBrief(store, pr.id, {
      headSha: HEAD,
      headIndex: 1,
      chunkLayout: LAYOUT,
    });
    await writeBrief(store, pr.id, {
      headSha: HEAD,
      headIndex: 1,
      chunkLayout: next,
    });

    expect(readBody(await store.chunkLayouts.get(pr.id, BASE, HEAD))).toEqual(
      next,
    );
  });

  it("drops the sidecar when a rewrite carries no counts", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = createArtifactStore(shared.handle, CTX_A);
    await writeBrief(store, pr.id, {
      headSha: HEAD,
      headIndex: 1,
      chunkLayout: LAYOUT,
    });
    await writeBrief(store, pr.id, { headSha: HEAD, headIndex: 1 });

    expect(await store.chunkLayouts.get(pr.id, BASE, HEAD)).toBe(undefined);
  });

  it("refuses counts beyond the shape and writes neither row", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = createArtifactStore(shared.handle, CTX_A);
    const leaky = { chunks: { c1: { ...COUNTS, content: "const a = 1;" } } };

    await expect(
      writeBrief(store, pr.id, {
        headSha: HEAD,
        headIndex: 1,
        chunkLayout: { ...leaky, files: {} },
      }),
    ).rejects.toBeInstanceOf(InvalidArtifactBodyError);
    expect(await store.briefs.get(pr.id, BASE, HEAD)).toBe(undefined);
  });

  it("answers undefined for a brief without a sidecar", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = createArtifactStore(shared.handle, CTX_A);
    await writeBrief(store, pr.id, {
      headSha: HEAD,
      headIndex: 1,
      chunkLayout: LAYOUT,
    });
    const bareId = await writeBrief(store, pr.id, {
      headSha: OTHER_HEAD,
      headIndex: 2,
    });

    expect(await store.chunkLayouts.get(pr.id, BASE, OTHER_HEAD)).toBe(
      undefined,
    );
    expect(await store.chunkLayouts.has(bareId)).toBe(false);
  });

  it("fills a brief stored without a sidecar", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = createArtifactStore(shared.handle, CTX_A);
    const briefId = await writeBrief(store, pr.id, {
      headSha: HEAD,
      headIndex: 1,
    });

    const filled = await store.chunkLayouts.backfill({
      pullRequestId: pr.id,
      briefId,
      body: LAYOUT,
    });

    expect(filled).toBe(true);
    expect(await store.chunkLayouts.has(briefId)).toBe(true);
    expect(readBody(await store.chunkLayouts.get(pr.id, BASE, HEAD))).toEqual(
      LAYOUT,
    );
  });

  it("keeps the sidecar a brief already has over a backfill", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = createArtifactStore(shared.handle, CTX_A);
    const briefId = await writeBrief(store, pr.id, {
      headSha: HEAD,
      headIndex: 1,
      chunkLayout: LAYOUT,
    });

    const filled = await store.chunkLayouts.backfill({
      pullRequestId: pr.id,
      briefId,
      body: { chunks: {}, files: {} },
    });

    expect(filled).toBe(false);
    expect(readBody(await store.chunkLayouts.get(pr.id, BASE, HEAD))).toEqual(
      LAYOUT,
    );
  });

  it("refuses a backfill beyond counts without writing", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = createArtifactStore(shared.handle, CTX_A);
    const briefId = await writeBrief(store, pr.id, {
      headSha: HEAD,
      headIndex: 1,
    });

    await expect(
      store.chunkLayouts.backfill({
        pullRequestId: pr.id,
        briefId,
        body: { chunks: { c1: { ...COUNTS, content: "x" } }, files: {} },
      }),
    ).rejects.toBeInstanceOf(InvalidArtifactBodyError);
    expect(await store.chunkLayouts.has(briefId)).toBe(false);
  });

  it("refuses a backfill on a brief outside the caller's tenant", async () => {
    const prA = await openPullRequest(CTX_A);
    const storeA = createArtifactStore(shared.handle, CTX_A);
    const briefId = await writeBrief(storeA, prA.id, {
      headSha: HEAD,
      headIndex: 1,
    });
    const prB = await openPullRequest(CTX_B);
    const storeB = createArtifactStore(shared.handle, CTX_B);

    await expect(
      storeB.chunkLayouts.backfill({
        pullRequestId: prB.id,
        briefId,
        body: LAYOUT,
      }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    expect(await storeA.chunkLayouts.has(briefId)).toBe(false);
  });

  it("keeps a tenant's sidecar out of another tenant's read", async () => {
    const prA = await openPullRequest(CTX_A);
    const storeA = createArtifactStore(shared.handle, CTX_A);
    const briefId = await writeBrief(storeA, prA.id, {
      headSha: HEAD,
      headIndex: 1,
      chunkLayout: LAYOUT,
    });

    const storeB = createArtifactStore(shared.handle, CTX_B);
    expect(await storeB.chunkLayouts.get(prA.id, BASE, HEAD)).toBe(undefined);
    expect(await storeB.chunkLayouts.has(briefId)).toBe(false);
  });

  it("serves the owner world under a null installation", async () => {
    const pr = await openPullRequest(OWNER_CTX_A);
    const store = createArtifactStore(shared.handle, OWNER_CTX_A);
    const briefId = await writeBrief(store, pr.id, {
      headSha: HEAD,
      headIndex: 1,
      chunkLayout: LAYOUT,
    });

    const owned = await store.chunkLayouts.get(pr.id, BASE, HEAD);
    const tenantRead = createArtifactStore(shared.handle, CTX_A);

    expect(owned?.briefId).toBe(briefId);
    expect(await tenantRead.chunkLayouts.get(pr.id, BASE, HEAD)).toBe(
      undefined,
    );
  });

  it("dies with its pull request by cascade", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = createArtifactStore(shared.handle, CTX_A);
    await writeBrief(store, pr.id, {
      headSha: HEAD,
      headIndex: 1,
      chunkLayout: LAYOUT,
    });

    const purged = await createPurgeRoutines(
      shared.handle,
      CTX_A,
    ).purgePullRequest(pr.id);
    const rows = await internal(shared.handle)
      .select({ id: chunkLayoutTable.id })
      .from(chunkLayoutTable);

    expect(purged).toBe(true);
    expect(rows).toHaveLength(0);
  });
});
