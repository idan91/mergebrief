// GenerationPartStore tests (PGlite): a part upserts on its span and key, its
// body is a grouping output or chunks only, a span's parts delete together,
// and both scope worlds keep their parts to themselves.
import type { PartKey } from "brief-core";
import { describe, expect, it } from "vitest";
import {
  createGenerationPartStore,
  createGenerationProjection,
  createTenantRepository,
  GenerationKinds,
  GenerationPartKinds,
  InvalidArtifactBodyError,
  ScopeViolationError,
  sweepStaleGenerationParts,
  type GenerationPartBody,
  type GenerationPartStore,
  type GenerationSpan,
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
import { GenerationPhases } from "types/generations";
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

/** The digest a worker stamps a grouping part with; any sha-256 hex fits the schema. */
const GIT_ATTRIBUTES_DIGEST = "0".repeat(64);

const GROUPING = {
  summary: "Refactors two modules.",
  changeGroups: [
    {
      id: "g1",
      title: "Group g1",
      summary: "What g1 does.",
      dominantCategory: "logic-refactor",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  hunkMap: [{ groupId: "g1", hunks: ["f1"] }],
  intentCheck: {
    ticketUrls: [],
    ticketTitles: [],
    specificity: "none",
    scopeNote: "",
    items: [],
    alignment: { read: "", goal: "", response: "" },
  },
};

function makeDetailBody(chunks: unknown[]) {
  return { kind: GenerationPartKinds.DETAIL, chunks };
}

function readChunkIds(body: GenerationPartBody): string[] {
  if (body.kind !== GenerationPartKinds.DETAIL) {
    return [];
  }
  return body.chunks.map((chunk) => chunk.id);
}

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
      body: makeDetailBody([makeChunk("c1", ["no-tests"])]),
    });

    expect(written.partKey).toBe("detail:1");
    expect(readChunkIds(written.body)).toEqual(["c1"]);
    const listed = await store.listForSpan({
      pullRequestId: pr.id,
      baseSha: BASE,
      headSha: HEAD,
    });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(written.id);
    expect(listed[0]?.body).toEqual(
      makeDetailBody([makeChunk("c1", ["no-tests"])]),
    );
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
      body: makeDetailBody([makeChunk("c1")]),
    });
    const second = await store.write({
      ...span,
      partKey: "detail:2",
      body: makeDetailBody([makeChunk("c2")]),
    });

    expect(second.id).toBe(first.id);
    const listed = await store.listForSpan(span);
    expect(listed.map((row) => readChunkIds(row.body)[0])).toEqual(["c2"]);
  });

  it("lists a span's parts oldest first and keeps other spans apart", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = openStore(CTX_A);
    const span = { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD };
    await store.write({
      ...span,
      partKey: "detail:2",
      body: makeDetailBody([]),
    });
    await store.write({
      ...span,
      partKey: "detail:1",
      body: makeDetailBody([]),
    });
    await store.write({
      ...span,
      headSha: OTHER_HEAD,
      partKey: "detail:1",
      body: makeDetailBody([]),
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
      body: makeDetailBody([makeChunk("c1", ["touches-billing"])]),
    });

    const chunk =
      written.body.kind === GenerationPartKinds.DETAIL
        ? written.body.chunks[0]
        : undefined;
    expect(chunk?.riskSurface).toEqual(["touches-billing"]);
  });

  it("stores the grouping call's output as a grouping part", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = openStore(CTX_A);
    const span = { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD };

    const body = {
      kind: GenerationPartKinds.GROUPING,
      grouping: GROUPING,
      gitAttributesDigest: GIT_ATTRIBUTES_DIGEST,
      anchorPlanDigest: GIT_ATTRIBUTES_DIGEST,
    };

    const written = await store.write({ ...span, partKey: "grouping", body });

    expect(written.body).toEqual(body);
    const listed = await store.listForSpan(span);
    expect(listed.map((row) => row.body.kind)).toEqual(["grouping"]);
  });

  it("drops the Summary Media an older grouping part carries", async () => {
    const pr = await openPullRequest(CTX_A);
    const store = openStore(CTX_A);
    const span = { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD };
    const body = {
      kind: GenerationPartKinds.GROUPING,
      grouping: GROUPING,
      gitAttributesDigest: GIT_ATTRIBUTES_DIGEST,
      anchorPlanDigest: GIT_ATTRIBUTES_DIGEST,
    };
    const summaryMedia = {
      shown: [{ key: "https://cdn.test/a.png", position: "after-lede" }],
    };

    const written = await store.write({
      ...span,
      partKey: "grouping",
      body: { ...body, grouping: { ...GROUPING, summaryMedia } },
    });

    expect(written.body).toEqual(body);
  });

  it.each([
    ["a key beyond the chunks", { ...makeDetailBody([]), patch: "+code" }],
    [
      "a chunk carrying code text",
      makeDetailBody([{ ...makeChunk("c1"), lines: ["+x"] }]),
    ],
    ["a body with no kind", { chunks: [] }],
    ["a body of an unknown kind", { kind: "outline", form: "full" }],
    [
      "a grouping part carrying chunks",
      {
        kind: GenerationPartKinds.GROUPING,
        grouping: GROUPING,
        gitAttributesDigest: GIT_ATTRIBUTES_DIGEST,
        anchorPlanDigest: GIT_ATTRIBUTES_DIGEST,
        chunks: [],
      },
    ],
    [
      "a grouping part without its .gitattributes digest",
      { kind: GenerationPartKinds.GROUPING, grouping: GROUPING },
    ],
    [
      "a chunk with a malformed risk token",
      makeDetailBody([makeChunk("c1", ["Not A Token"])]),
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
          body: makeDetailBody([]),
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
    await store.write({
      ...span,
      partKey: "detail:1",
      body: makeDetailBody([]),
    });
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
    await store.write({
      ...span,
      partKey: "detail:1",
      body: makeDetailBody([]),
    });
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
    await store.write({
      ...span,
      partKey: "detail:1",
      body: makeDetailBody([]),
    });
    await store.write({
      ...span,
      partKey: "detail:2",
      body: makeDetailBody([]),
    });
    await store.write({
      ...other,
      partKey: "detail:1",
      body: makeDetailBody([]),
    });

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

describe("sweepStaleGenerationParts", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;

  async function ageSpanParts(headSha: string, days: number): Promise<void> {
    await shared.harness.raw(
      `update generation_part set created_at = now() - interval '${String(days)} days' where head_sha = '${headSha}'`,
    );
  }

  async function writeDetailPart(
    span: GenerationSpan,
    partKey: PartKey,
  ): Promise<void> {
    await openStore(CTX_A).write({
      ...span,
      partKey,
      body: makeDetailBody([]),
    });
  }

  it("deletes a span idle past a week and keeps a recent one", async () => {
    const pr = await openPullRequest(CTX_A);
    const stale = { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD };
    const recent = { ...stale, headSha: OTHER_HEAD };
    await writeDetailPart(stale, "detail:1");
    await writeDetailPart(stale, "detail:2");
    await writeDetailPart(recent, "detail:1");
    await ageSpanParts(HEAD, 8);
    await ageSpanParts(OTHER_HEAD, 6);

    const deleted = await sweepStaleGenerationParts(shared.handle, new Date());

    expect(deleted).toBe(2);
    const store = openStore(CTX_A);
    expect(await store.listForSpan(stale)).toEqual([]);
    expect(await store.listForSpan(recent)).toHaveLength(1);
  });

  it("keeps a whole span while any of its parts is recent", async () => {
    const pr = await openPullRequest(CTX_A);
    const span = { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD };
    await writeDetailPart(span, "detail:1");
    await ageSpanParts(HEAD, 8);
    await writeDetailPart(span, "detail:2");

    const deleted = await sweepStaleGenerationParts(shared.handle, new Date());

    expect(deleted).toBe(0);
    expect(await openStore(CTX_A).listForSpan(span)).toHaveLength(2);
  });

  it("keeps a stale span whose head a run holds under a live lease", async () => {
    const pr = await openPullRequest(CTX_A);
    const span = { pullRequestId: pr.id, baseSha: BASE, headSha: HEAD };
    await writeDetailPart(span, "detail:1");
    await ageSpanParts(HEAD, 8);
    const projection = createGenerationProjection(shared.handle, CTX_A);
    const target = {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: HEAD,
      baselineSha: null,
    };
    await projection.upsertPending(target);
    const claimed = await projection.claimRun({
      target,
      phase: GenerationPhases.GENERATING,
      leaseMs: 120_000,
      from: new Date(0),
      to: new Date(Date.now() + DAY_MS),
    });
    expect(claimed.ok).toBe(true);

    const deleted = await sweepStaleGenerationParts(shared.handle, new Date());

    expect(deleted).toBe(0);
    expect(await openStore(CTX_A).listForSpan(span)).toHaveLength(1);
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
        body: makeDetailBody([]),
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
      body: makeDetailBody([]),
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
      body: makeDetailBody([]),
    });

    expect(await openStore(OWNER_CTX_B).listForSpan(span)).toEqual([]);
    await expect(
      openStore(OWNER_CTX_B).write({
        ...span,
        partKey: "detail:2",
        body: makeDetailBody([]),
      }),
    ).rejects.toBeInstanceOf(ScopeViolationError);
    expect(await openStore(OWNER_CTX_A).listForSpan(span)).toHaveLength(1);
  });
});
