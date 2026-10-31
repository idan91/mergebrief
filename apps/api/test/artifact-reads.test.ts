// The stored artifact reads (brief, brief-context, brief-layout, marks, delta,
// narrative)
// over PGlite: each serves its stored body verbatim from the row the access
// step loaded, answers a missing span 404 and a malformed query 400, and
// never calls GitHub past the gate.
import { makeFakeGitHub, type FakeGitHub } from "github/testing";
import {
  createArtifactStore,
  createTenantRepository,
  type AppDatabase,
  type BriefRowId,
  type KeyProvider,
  type PullRequestRow,
  type ScopeContext,
} from "persistence";
import { PrStates } from "types/pull-requests";
import type { Mutable } from "types/utils";
import type { BriefWriteInput } from "persistence";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  REVIEWER_ID,
  SECRET,
  brandInstallationId,
  brandRepoId,
  brandReviewerId,
  createKeyProvider,
} from "./fixtures";
import { testLogger } from "./logging";
import { spyPullRequestLookups } from "./pull-request-lookups";
import {
  UNUSED_INSTALLATION_DEPS,
  buildFakeAuthDeps,
  arrangeFakeGate,
  listCallsPastGate,
} from "./reviewer-github";
import { seedSignIn } from "./sign-in";
import { registerSharedPglite } from "./shared-pglite";
import { STORED_BODY_VERSION } from "brief-core/artifact";

const REPO_ID = 424242;
const CTX = { installationId: brandInstallationId(BigInt(INSTALLATION_ID)) };
const OWNER_CTX = { ownerUserId: brandReviewerId(BigInt(REVIEWER_ID)) };
const BRIEF_BODY = JSON.stringify({ summary: "the brief", findings: [] });
const DELTA_BODY = JSON.stringify({ summary: "the delta", changes: [] });
const NARRATIVE_BODY = JSON.stringify({ summary: "what moved" });
const LAYOUT_COUNTS = {
  rows: 4,
  hunkRows: 1,
  expandRows: 1,
  splitRows: 3,
  lineWidths: { counts: [3, 0, 0, 0, 0, 0, 0, 0, 0], overflowColumns: 0 },
};
const LAYOUT_BODY = {
  chunks: { c1: LAYOUT_COUNTS },
  files: { "src/orphan.ts": LAYOUT_COUNTS },
};
const ROW_RUNS_LAYOUT_BODY = {
  chunks: {
    c1: {
      ...LAYOUT_COUNTS,
      splitLineWidths: {
        counts: [2, 0, 0, 0, 0, 0, 0, 0, 0],
        overflowColumns: 0,
      },
      rowRuns: "h1c1a1c1e1",
    },
  },
  files: { "src/orphan.ts": LAYOUT_COUNTS },
};
const PULL_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}`;

async function seedPullRequest(
  handle: AppDatabase,
  scope: ScopeContext = CTX,
): Promise<PullRequestRow> {
  return createTenantRepository(handle, scope).pullRequests.upsert({
    repoId: brandRepoId(BigInt(REPO_ID)),
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
}

interface BriefSeed {
  readonly base: string;
  readonly head: string;
  readonly repoConfig?: string;
  readonly scope?: ScopeContext;
  readonly body?: string;
}

async function seedBrief(
  handle: AppDatabase,
  pr: PullRequestRow,
  seed: BriefSeed,
): Promise<BriefRowId> {
  const store = createArtifactStore(handle, seed.scope ?? CTX);
  const prior = await store.briefs.listForPullRequest(pr.id);
  const write: Mutable<BriefWriteInput> = {
    pullRequestId: pr.id,
    baseSha: seed.base,
    headSha: seed.head,
    headIndex: (prior.at(-1)?.headIndex ?? 0) + 1,
    commitCount: 3,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    bodyVersion: STORED_BODY_VERSION,
    body: seed.body ?? BRIEF_BODY,
    usedGroupIds: [],
  };
  if (seed.repoConfig !== undefined) {
    write.repoConfig = seed.repoConfig;
  }

  const written = await store.briefs.write(write);
  return written.id;
}

describe("stored artifact reads", () => {
  const harness = registerSharedPglite();
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let app: ApiApp;
  let cookie: string;

  beforeEach(async () => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
    });
    ({ cookie } = await seedSignIn(harness.handle, kp));
  });

  async function get(path: string): Promise<Response> {
    return app.request(`${PULL_PATH}${path}`, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  async function readCode(res: Response): Promise<unknown> {
    const body: unknown = await res.json();
    return typeof body === "object" && body !== null && "code" in body
      ? body.code
      : undefined;
  }

  it("serves a stored brief verbatim and 404s a missing span", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    const pr = await seedPullRequest(harness.handle);
    await seedBrief(harness.handle, pr, { base: "base1", head: "head1" });
    const lookups = spyPullRequestLookups(harness);

    const res = await get("/brief?base=base1&head=head1");
    const missing = await get("/brief?base=base1&head=nope");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(BRIEF_BODY);
    expect(missing.status).toBe(404);
    expect(await readCode(missing)).toBe("not-found");
    expect(lookups.count()).toBe(2);
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("serves a card's row runs and split widths as stored", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    const pr = await seedPullRequest(harness.handle);
    const briefId = await seedBrief(harness.handle, pr, {
      base: "base1",
      head: "head1",
    });
    await createArtifactStore(harness.handle, CTX).chunkLayouts.backfill({
      pullRequestId: pr.id,
      briefId,
      body: ROW_RUNS_LAYOUT_BODY,
    });

    const res = await get("/brief-layout?base=base1&head=head1");

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ layout: ROW_RUNS_LAYOUT_BODY });
  });

  it("400s a brief query missing its head", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedPullRequest(harness.handle);

    const res = await get("/brief?base=only");

    expect(res.status).toBe(400);
    expect(await readCode(res)).toBe("invalid-request");
  });

  it("serves snapshots, null for legacy rows, and 404 for missing rows", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    const pr = await seedPullRequest(harness.handle);
    const snapshot = '{"files":[],"collisions":[],"policy":null}';
    await seedBrief(harness.handle, pr, {
      base: "base1",
      head: "head1",
      repoConfig: snapshot,
    });
    await seedBrief(harness.handle, pr, { base: "base1", head: "head2" });

    const withConfig = await get("/brief-context?base=base1&head=head1");
    const nullConfig = await get("/brief-context?base=base1&head=head2");
    const missing = await get("/brief-context?base=base1&head=nope");
    const malformed = await get("/brief-context?base=only");

    expect(withConfig.status).toBe(200);
    expect(withConfig.headers.get("cache-control")).toBe("no-store");
    expect(await withConfig.text()).toBe(`{"repoConfig":${snapshot}}`);
    expect(nullConfig.status).toBe(200);
    expect(await nullConfig.text()).toBe('{"repoConfig":null}');
    expect(missing.status).toBe(404);
    expect(await readCode(missing)).toBe("not-found");
    expect(malformed.status).toBe(400);
    expect(await readCode(malformed)).toBe("invalid-request");
  });

  it("serves a brief's layout, null for a brief without one", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    const pr = await seedPullRequest(harness.handle);
    const briefId = await seedBrief(harness.handle, pr, {
      base: "base1",
      head: "head1",
    });
    await seedBrief(harness.handle, pr, { base: "base1", head: "head2" });
    await createArtifactStore(harness.handle, CTX).chunkLayouts.backfill({
      pullRequestId: pr.id,
      briefId,
      body: LAYOUT_BODY,
    });

    const res = await get("/brief-layout?base=base1&head=head1");
    const bare = await get("/brief-layout?base=base1&head=head2");
    const missing = await get("/brief-layout?base=base1&head=nope");
    const malformed = await get("/brief-layout?base=only");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ layout: LAYOUT_BODY });
    expect(bare.status).toBe(200);
    expect(await bare.text()).toBe('{"layout":null}');
    expect(missing.status).toBe(404);
    expect(await readCode(missing)).toBe("not-found");
    expect(malformed.status).toBe(400);
    expect(await readCode(malformed)).toBe("invalid-request");
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("serves stored marks and 404s a missing span", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    const pr = await seedPullRequest(harness.handle);
    await createArtifactStore(harness.handle, CTX).comparisonMarks.write({
      pullRequestId: pr.id,
      marks: { baselineSha: "head-1", headSha: "head-2", files: [] },
    });

    const res = await get("/marks?baseline=head-1&head=head-2");
    const missing = await get("/marks?baseline=head-1&head=nope");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toMatchObject({
      baselineSha: "head-1",
      headSha: "head-2",
    });
    expect(missing.status).toBe(404);
  });

  it("serves stored deltas and 404s a missing span", async () => {
    const gate = arrangeFakeGate(fake, { repoId: REPO_ID });
    const pr = await seedPullRequest(harness.handle);
    await createArtifactStore(harness.handle, CTX).deltas.write({
      pullRequestId: pr.id,
      baselineSha: "cp-1",
      headSha: "head-2",
      provider: "anthropic",
      model: "claude",
      effort: "high",
      bodyVersion: STORED_BODY_VERSION,
      body: DELTA_BODY,
    });

    const res = await get("/delta?baseline=cp-1&head=head-2");
    const missing = await get("/delta?baseline=cp-1&head=nope");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe(DELTA_BODY);
    expect(missing.status).toBe(404);
    // Positive authz cache: one access check covered both reads.
    expect(gate.repositoryReads()).toBe(1);
  });

  it("404s a span whose delta row is its skip record", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    const pr = await seedPullRequest(harness.handle);
    await createArtifactStore(harness.handle, CTX).deltas.write({
      pullRequestId: pr.id,
      baselineSha: "cp-1",
      headSha: "head-2",
      provider: "anthropic",
      model: "claude",
      effort: "high",
      bodyVersion: STORED_BODY_VERSION,
      body: JSON.stringify({ artifactKind: "deltaSkipped" }),
    });

    const res = await get("/delta?baseline=cp-1&head=head-2");

    expect(res.status).toBe(404);
  });

  it("400s delta queries with cross-repo refs or missing parameters", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedPullRequest(harness.handle);

    const crossRepo = await get("/delta?baseline=evil:main&head=head-2");
    const missingHead = await get("/delta?baseline=only");

    expect(crossRepo.status).toBe(400);
    expect(missingHead.status).toBe(400);
  });

  it("serves a stored narrative and 404s a missing span", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    const pr = await seedPullRequest(harness.handle);
    const briefId = await seedBrief(harness.handle, pr, {
      base: "base1",
      head: "head-2",
    });
    await createArtifactStore(harness.handle, CTX).revisionNarratives.write({
      pullRequestId: pr.id,
      briefId,
      prevHeadSha: "head-1",
      headSha: "head-2",
      body: NARRATIVE_BODY,
      provider: "anthropic",
      model: "claude",
      effort: "high",
      bodyVersion: STORED_BODY_VERSION,
    });

    const res = await get("/narrative?prevHead=head-1&head=head-2");
    const missing = await get("/narrative?prevHead=head-0&head=head-2");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe(NARRATIVE_BODY);
    expect(missing.status).toBe(404);
  });

  it("reads a url row's brief from its owner's world", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, inInstallation: false });
    const pr = await seedPullRequest(harness.handle, OWNER_CTX);
    await seedBrief(harness.handle, pr, {
      base: "base1",
      head: "head1",
      scope: OWNER_CTX,
      body: '{"world":"owner"}',
    });
    const lookups = spyPullRequestLookups(harness);

    const res = await get("/brief?base=base1&head=head1");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"world":"owner"}');
    expect(lookups.count()).toBe(1);
  });
});
