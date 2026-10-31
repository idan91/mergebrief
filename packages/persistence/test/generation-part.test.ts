// GenerationPartStore tests (PGlite): a part upserts on its span and key, its
// body is chunks only, a span's parts delete together, and both scope worlds
// keep their parts to themselves.
import type { PartKey } from "brief-core";
import { describe, expect, it } from "vitest";
import {
  createGenerationPartStore,
  createTenantRepository,
  InvalidArtifactBodyError,
  ScopeViolationError,
  type GenerationPartStore,
  type OwnerContext,
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
import { PrStates } from "types/pull-requests";
import { brandWith, registerSharedPglite } from "./helpers";

const shared = registerSharedPglite();

const TENANT_A: InstallationId = brandWith(isInstallationId, 1000n);
const TENANT_B: InstallationId = brandWith(isInstallationId, 2000n);
const OWNER_A: ReviewerId = brandWith(isReviewerId, 501n);
const OWNER_B: ReviewerId = brandWith(isReviewerId, 502n);
const REPO: RepoId = brandWith(isRepoId, 777n);
const CTX_A: TenantContext = { installationId: TENANT_A };
const CTX_B: TenantContext = { installationId: TENANT_B };
const OWNER_CTX_A: OwnerContext = { ownerUserId: OWNER_A };
const OWNER_CTX_B: OwnerContext = { ownerUserId: OWNER_B };

const BASE = "a".repeat(40);
const HEAD = "b".repeat(40);
const OTHER_HEAD = "c".repeat(40);

function makeChunk(id: string, riskSurface: string[] = []) {
  return {
    id,
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: "implementation",
    role: "core",
    addedRanges: [{ start: 1, end: 3 }],
    removedRanges: [],
    riskSurface,
  };
}

async function openPullRequest(ctx: TenantContext | OwnerContext) {
  const repo = createTenantRepository(shared.handle, ctx);
  return repo.pullRequests.upsert({
    repoId: REPO,
    prNumber: 7,
    repoSlug: "acme/widgets",
    state: PrStates.OPEN,
  });
}

function openStore(ctx: TenantContext | OwnerContext): GenerationPartStore {
  return createGenerationPartStore(shared.handle, ctx);
}

describe("createGenerationPartStore.write", () => {
  it("stores a part and lists it back with its chunks parsed", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = openStore(CTX_A);

    const written = await store.write({
      pullRequestId: pr.id,
      baseSha: BASE,
      headSha: HEAD,
      partKey: "detail:1",
      body: { chunks: [makeChunk("c1", ["no-tests"])] },
    });

    expect(written.partKey).toBe("detail:1");
    expect(written.body.chunks[0]?.id).toBe("c1");
    const listed = await store.listForSpan({
      pullRequestId: pr.id,
      baseSha: BASE,
      headSha: HEAD,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(written.id);
    expect(listed[0]?.body).toEqual({
      chunks: [makeChunk("c1", ["no-tests"])],
    });
    expect(listed[0]?.byteSize).toBe(
      Buffer.byteLength(JSON.stringify(listed[0]?.body), "utf8"),
    );
  });

  it("rewrites the same span and key in place as one row", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = openStore(CTX_A);
    const span = { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD };

    const first = await store.write({
      ...span,
      partKey: "detail:2",
      body: { chunks: [makeChunk("c1")] },
    });
    const second = await store.write({
      ...span,
      partKey: "detail:2",
      body: { chunks: [makeChunk("c2")] },
    });

    expect(second.id).toBe(first.id);
    const listed = await store.listForSpan(span);
    expect(listed.map((row) => row.body.chunks[0]?.id)).toEqual(["c2"]);
  });

  it("lists a span's parts oldest first and keeps other spans apart", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = openStore(CTX_A);
    const span = { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD };
    await store.write({ ...span, partKey: "detail:2", body: { chunks: [] } });
    await store.write({ ...span, partKey: "detail:1", body: { chunks: [] } });
    await store.write({
      ...span,
      headSha: OTHER_HEAD,
      partKey: "detail:1",
      body: { chunks: [] },
    });

    const listed = await store.listForSpan(span);

    expect(listed.map((row) => row.partKey)).toEqual(["detail:2", "detail:1"]);
  });

  it("accepts a repo's custom risk attribute name on a chunk", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = openStore(CTX_A);

    const written = await store.write({
      pullRequestId: pr.id,
      baseSha: BASE,
      headSha: HEAD,
      partKey: "detail:1",
      body: { chunks: [makeChunk("c1", ["touches-billing"])] },
    });

    expect(written.body.chunks[0]?.riskSurface).toEqual(["touches-billing"]);
  });

  it.each([
    ["a key beyond the chunks", { chunks: [], patch: "+code" }],
    [
      "a chunk carrying code text",
      { chunks: [{ ...makeChunk("c1"), lines: ["+x"] }] },
    ],
    ["a body with no chunks", { groups: [] }],
    [
      "a chunk with a malformed risk token",
      { chunks: [makeChunk("c1", ["Not A Token"])] },
    ],
  ])("refuses %s and writes nothing", async (_label, body) => {
    const pr = await openPullRequest(CTX_A);
    const store = openStore(CTX_A);
    const span = { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD };

    await expect(
      store.write({ ...span, partKey: "detail:1", body }),
    ).rejects.toBeInstanceOf(InvalidArtifactBodyError);
    expect(await store.listForSpan(span)).toEqual([]);
  });

  it.each(["Detail 1", "detail:0", "detail:1:3", "detail:a"])(
    "refuses the part key %s",
    async (partKey) => {
      const pr = await openPullRequest(CTX_A);
      const store = openStore(CTX_A);

      await expect(
        store.write({
          pullRequestId: pr.id,
          baseSha: BASE,
          headSha: HEAD,
          partKey: partKey as PartKey,
          body: { chunks: [] },
        }),
      ).rejects.toThrow(/part key/);
    },
  );
});

describe("createGenerationPartStore.listForSpan", () => {
  it("refuses a stored key the engine never names", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = openStore(CTX_A);
    const span = { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD };
    await store.write({ ...span, partKey: "detail:1", body: { chunks: [] } });
    await shared.harness.raw(
      "update generation_part set part_key = 'detail:a'",
    );

    await expect(store.listForSpan(span)).rejects.toBeInstanceOf(
      InvalidArtifactBodyError,
    );
  });

  it("refuses a stored body that is not JSON", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = openStore(CTX_A);
    const span = { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD };
    await store.write({ ...span, partKey: "detail:1", body: { chunks: [] } });
    await shared.harness.raw("update generation_part set body = '{chunks'");

    await expect(store.listForSpan(span)).rejects.toBeInstanceOf(
      InvalidArtifactBodyError,
    );
  });
});

describe("createGenerationPartStore.deleteForSpan", () => {
  it("deletes the span's parts only and answers how many went", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = openStore(CTX_A);
    const span = { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD };
    const other = { ...span, headSha: OTHER_HEAD };
    await store.write({ ...span, partKey: "detail:1", body: { chunks: [] } });
    await store.write({ ...span, partKey: "detail:2", body: { chunks: [] } });
    await store.write({ ...other, partKey: "detail:1", body: { chunks: [] } });

    const deleted = await store.deleteForSpan(span);

    expect(deleted).toBe(2);
    expect(await store.listForSpan(span)).toEqual([]);
    expect(await store.listForSpan(other)).toHaveLength(1);
  });

  it("answers zero for a span with no parts", async () => {
    const pr = await openPullRequest(CTX_A);

    const deleted = await openStore(CTX_A).deleteForSpan({
      pullRequestId: pr.id,
      baseSha: BASE,
      headSha: HEAD,
    });

    expect(deleted).toBe(0);
  });
});

describe("createGenerationPartStore scope containment", () => {
  it("refuses another tenant's pull request before any insert", async () => {
    const pr = await openPullRequest(CTX_A);
    const span = { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD };

    await expect(
      openStore(CTX_B).write({
        ...span,
        partKey: "detail:1",
        body: { chunks: [] },
      }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    expect(await openStore(CTX_A).listForSpan(span)).toEqual([]);
  });

  it("neither lists nor deletes another tenant's parts", async () => {
    const pr = await openPullRequest(CTX_A);
    const span = { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD };
    await openStore(CTX_A).write({
      ...span,
      partKey: "detail:1",
      body: { chunks: [] },
    });

    expect(await openStore(CTX_B).listForSpan(span)).toEqual([]);
    expect(await openStore(CTX_B).deleteForSpan(span)).toBe(0);
    expect(await openStore(CTX_A).listForSpan(span)).toHaveLength(1);
  });

  it("keeps one url-box owner's parts from another owner", async () => {
    const pr = await openPullRequest(OWNER_CTX_A);
    const span = { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD };
    await openStore(OWNER_CTX_A).write({
      ...span,
      partKey: "detail:1",
      body: { chunks: [] },
    });

    expect(await openStore(OWNER_CTX_B).listForSpan(span)).toEqual([]);
    await expect(
      openStore(OWNER_CTX_B).write({
        ...span,
        partKey: "detail:2",
        body: { chunks: [] },
      }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    expect(await openStore(OWNER_CTX_A).listForSpan(span)).toHaveLength(1);
  });
});
