// GET /api/repos/:repoId/pulls/:prNumber over PGlite: the gate on the
// viewer's token, the revision timeline, the generation summary and behind.
import {
  CredentialKinds,
  FakeFactsHidings,
  FakeFailures,
  makeFakeGitHub,
  type FakeGitHub,
} from "github/testing";
import {
  createArtifactStore,
  createTenantRepository,
  createGenerationProjection,
  createIngestRoutines,
  GenerationKinds,
  isInstallationId,
  isRepoId,
  isReviewerId,
  type AppDatabase,
  type KeyProvider,
  type TenantContext,
  type ScopeContext,
  type PullRequestUpsertInput,
  type PullRequestRowId,
} from "persistence";
import { GenerationFailureCodes, GenerationStatuses } from "types/generations";
import { PrStates } from "types/pull-requests";
import {
  claimTestRun,
  createPgliteHarness,
  succeedTestRun,
  type PgliteHarness,
} from "persistence/testing";
import { WaitReasons } from "contract";
import type { Mutable } from "types/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { resetLiveReadMemory } from "../src/routes/live-read";
import { testLogger } from "./logging";
import {
  INSTALLATION_ID,
  REVIEWER_ID,
  SECRET,
  buildOperatorToken,
  createKeyProvider,
} from "./fixtures";
import { spyPullRequestLookups } from "./pull-request-lookups";
import {
  UNUSED_INSTALLATION_DEPS,
  arrangeFakePullRequest,
  buildFakeAuthDeps,
  listCallTokens,
  listCallsPastGate,
  arrangeFakeGate,
  type GateGitHub,
} from "./reviewer-github";
import { ACCESS_TOKEN, seedSignIn } from "./sign-in";

const OTHER_INSTALLATION_ID = 111222;
const REPO_A = 424242;
const WAIT_DEBOUNCE_SECONDS = 60;

/** The name the gate verifies, apart from the stored `octo/hello` slug. */
const VERIFIED_SLUG = "octo/verified-a";

function brand<T extends bigint>(
  guard: (v: bigint) => v is T,
  value: number,
): T {
  const asBigInt = BigInt(value);
  if (!guard(asBigInt)) {
    throw new Error("bad branded id");
  }
  return asBigInt;
}

const CTX: TenantContext = {
  installationId: brand(isInstallationId, INSTALLATION_ID),
};
const OTHER_CTX: TenantContext = {
  installationId: brand(isInstallationId, OTHER_INSTALLATION_ID),
};
const OWNER_CTX: ScopeContext = {
  ownerUserId: brand(isReviewerId, REVIEWER_ID),
};

interface SeedPrInput {
  readonly ctx?: ScopeContext;
  readonly repoId: number;
  readonly prNumber: number;
  readonly title?: string;
  readonly slug?: string;
  readonly baseSha?: string;
  readonly draft?: boolean;
  readonly authorLogin?: string;
  /** What GitHub last reported as the head, as a live read would stamp it. */
  readonly liveReadHeadSha?: string;
}

async function seedPr(handle: AppDatabase, input: SeedPrInput) {
  const ctx = input.ctx ?? CTX;
  const upsert: Mutable<PullRequestUpsertInput> = {
    repoId: brand(isRepoId, input.repoId),
    prNumber: input.prNumber,
    repoSlug: input.slug ?? "octo/hello",
    title: input.title ?? `PR ${input.prNumber}`,
    state: PrStates.OPEN,
  };

  if (input.baseSha !== undefined) {
    upsert.baseSha = input.baseSha;
  }
  if (input.draft !== undefined) {
    upsert.draft = input.draft;
  }
  if (input.authorLogin !== undefined) {
    upsert.authorLogin = input.authorLogin;
  }
  if (input.liveReadHeadSha !== undefined) {
    upsert.liveRead = { readAt: new Date(), headSha: input.liveReadHeadSha };
  }

  return createTenantRepository(handle, ctx).pullRequests.upsert(upsert);
}

// PR-meta `revisions[]` wire shape + runtime guards, the test boundary
// parses, never casts.
interface RevisionEntry {
  readonly headSha: string;
  readonly baseSha: string;
  readonly headIndex: number;
  readonly createdAt: string;
  readonly generatedAt: string;
  readonly comparisons: {
    readonly previousBrief?: Record<string, unknown>;
    readonly lastReview?: Record<string, unknown>;
  };
}

interface MetaRevisionsBody {
  readonly briefAvailable: boolean;
  readonly comparisons?: Record<string, unknown>;
  readonly revisions?: RevisionEntry[];
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRevisionEntry(value: unknown): value is RevisionEntry {
  if (!isPlainRecord(value)) {
    return false;
  }
  const comparisons = value["comparisons"];
  return (
    typeof value["headSha"] === "string" &&
    typeof value["baseSha"] === "string" &&
    typeof value["headIndex"] === "number" &&
    typeof value["createdAt"] === "string" &&
    typeof value["generatedAt"] === "string" &&
    isPlainRecord(comparisons)
  );
}

function isMetaRevisionsBody(value: unknown): value is MetaRevisionsBody {
  if (!isPlainRecord(value) || typeof value["briefAvailable"] !== "boolean") {
    return false;
  }
  const comparisons = value["comparisons"];
  if (comparisons !== undefined && !isPlainRecord(comparisons)) {
    return false;
  }
  const revisions = value["revisions"];
  return (
    revisions === undefined ||
    (Array.isArray(revisions) &&
      revisions.every((entry) => isRevisionEntry(entry)))
  );
}

describe("GET /api/repos/:repoId/pulls/:prNumber", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;
  let fake: FakeGitHub;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await harness.close();
  });

  async function get(path: string, cookie?: string): Promise<Response> {
    return app.request(
      path,
      cookie === undefined
        ? {}
        : { headers: { Cookie: `__Host-mergebrief_session=${cookie}` } },
    );
  }

  // --------------------------------------------------------------- PR meta

  async function signIn(): Promise<string> {
    const { cookie } = await seedSignIn(harness.handle, kp);
    return cookie;
  }

  /** The gate opens the repo under its verified name, inside the installation. */
  function stubGate(canPush = false): GateGitHub {
    return arrangeFakeGate(fake, {
      repoId: REPO_A,
      fullName: VERIFIED_SLUG,
      push: canPush,
    });
  }

  it("meta: uses artifact-read 404 posture for inaccessible or unknown PRs", async () => {
    arrangeFakeGate(fake, { repoId: REPO_A, viewerStatus: 404 });
    const cookie = await signIn();
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 1 });

    expect((await get(`/api/repos/${REPO_A}/pulls/1`)).status).toBe(401); // no cookie
    expect((await get(`/api/repos/${REPO_A}/pulls/1`, cookie)).status).toBe(
      404,
    ); // no repo access

    stubGate();
    expect((await get(`/api/repos/${REPO_A}/pulls/999`, cookie)).status).toBe(
      404,
    ); // unknown PR
    expect((await get(`/api/repos/${REPO_A}/pulls/nope`, cookie)).status).toBe(
      404,
    ); // bad number
  });

  it("meta: returns PR, span, brief availability and generation summary", async () => {
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, {
      repoId: REPO_A,
      prNumber: 7,
      title: "the pr",
      baseSha: "base-1",
    });
    const gen = createGenerationProjection(harness.handle, CTX);
    await gen.upsertPending({
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head-1",
      baselineSha: null,
    });

    const waiting = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(waiting.status).toBe(200);
    expect(waiting.headers.get("cache-control")).toBe("no-store");
    const waitingBody = (await waiting.json()) as Record<string, unknown>;
    expect(waitingBody).toMatchObject({
      repoId: String(REPO_A),
      repoSlug: "octo/verified-a",
      prNumber: 7,
      title: "the pr",
      state: "open",
      headSha: "head-1",
      // Persisted at ingest, the span is known before any brief.
      baseSha: "base-1",
      briefAvailable: false,
      generation: { status: GenerationStatuses.PENDING, attempts: 0 },
    });

    await createArtifactStore(harness.handle, CTX).briefs.write({
      pullRequestId: pr.id,
      baseSha: "base-1",
      headSha: "head-1",
      headIndex: 1,
      commitCount: 1,
      provider: "anthropic",
      model: "claude",
      effort: "high",
      body: "{}",
    });
    await succeedTestRun(gen, {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head-1",
      baselineSha: null,
    });

    const ready = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    const readyBody = (await ready.json()) as Record<string, unknown>;
    expect(readyBody).toMatchObject({
      headSha: "head-1",
      baseSha: "base-1",
      briefAvailable: true,
      generation: { status: GenerationStatuses.SUCCEEDED, phase: null },
    });
  });

  async function triggerPendingBrief(debounceSeconds: number) {
    const ingest = createIngestRoutines(harness.handle, CTX);
    const triggered = await ingest.triggerGeneration({
      pullRequest: {
        repoId: brand(isRepoId, REPO_A),
        prNumber: 7,
        state: PrStates.OPEN,
      },
      headSha: "head-1",
      debounceSeconds,
    });
    if (!triggered.ok) {
      throw new Error(triggered.error.message);
    }
    return triggered.value.pullRequest;
  }

  async function readGenerationSummary(path: string, cookie: string) {
    const res = await get(path, cookie);
    expect(res.status).toBe(200);
    const text = await res.text();
    const body = JSON.parse(text) as {
      generation?: Record<string, unknown>;
    };
    return { text, body };
  }

  /** The gate opens the repo on the viewer's token; no installation holds it. */
  function stubUrlWorld(): GateGitHub {
    resetLiveReadMemory();
    return arrangeFakeGate(fake, {
      repoId: REPO_A,
      fullName: VERIFIED_SLUG,
      inInstallation: false,
    });
  }

  /** GitHub reports `headSha` for the url row's PR under the verified name. */
  function arrangeLiveHead(prNumber: number, headSha: string): void {
    arrangeFakePullRequest(fake, {
      repoId: REPO_A,
      prNumber,
      fullName: VERIFIED_SLUG,
    });
    const [owner = "", repo = ""] = VERIFIED_SLUG.split("/");
    fake.updatePullRequest({ owner, repo, prNumber }, { headSha });
  }

  async function writeOwnerBrief(
    pullRequestId: PullRequestRowId,
    headSha: string,
    headIndex: number,
  ): Promise<void> {
    await createArtifactStore(harness.handle, OWNER_CTX).briefs.write({
      pullRequestId,
      baseSha: "base-1",
      headSha,
      headIndex,
      commitCount: headIndex,
      provider: "anthropic",
      model: "claude",
      effort: "high",
      body: "{}",
    });
  }

  async function readBehind(cookie: string): Promise<unknown> {
    const res = await get(`/api/repos/${REPO_A}/pulls/8`, cookie);
    expect(res.status).toBe(200);
    return ((await res.json()) as Record<string, unknown>)["behind"];
  }

  it("meta: a url row read live is behind once GitHub passes its brief", async () => {
    stubUrlWorld();
    arrangeLiveHead(8, "head-2");
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, {
      ctx: OWNER_CTX,
      repoId: REPO_A,
      prNumber: 8,
    });
    await writeOwnerBrief(pr.id, "head-1", 1);

    expect(await readBehind(cookie)).toBe(true);

    await writeOwnerBrief(pr.id, "head-2", 2);
    expect(await readBehind(cookie)).toBe(false);
  });

  it("meta: reads the PR row once per poll", async () => {
    stubGate();
    const cookie = await signIn();
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    const lookups = spyPullRequestLookups(harness);

    const res = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);

    expect(res.status).toBe(200);
    expect(lookups.count()).toBe(1);
    expect(listCallsPastGate(fake)).toEqual([]);
  });

  it("meta: a url row read live costs one row read and serves the write", async () => {
    stubUrlWorld();
    arrangeLiveHead(8, "head-2");
    const cookie = await signIn();
    await seedPr(harness.handle, {
      ctx: OWNER_CTX,
      repoId: REPO_A,
      prNumber: 8,
      title: "the stored title",
    });
    const lookups = spyPullRequestLookups(harness);

    const res = await get(`/api/repos/${REPO_A}/pulls/8`, cookie);
    const body: unknown = await res.json();

    expect(res.status).toBe(200);
    expect(lookups.count()).toBe(1);
    const written = await createTenantRepository(
      harness.handle,
      OWNER_CTX,
    ).pullRequests.getByNumber(brand(isRepoId, REPO_A), 8);
    expect(body).toMatchObject({
      title: "A pull request",
      updatedAt: written?.updatedAt.toISOString(),
    });
    expect(written?.githubHeadSha).toBe("head-2");
  });

  it("meta: a pass on the viewer's token never asks the operator", async () => {
    stubUrlWorld();
    arrangeLiveHead(8, "head-2");
    fake.hideFacts(
      { owner: "octo", repo: "verified-a", prNumber: 8 },
      CredentialKinds.REVIEWER,
      FakeFactsHidings.NOT_SHOWN,
    );
    const cookie = await signIn();
    await seedPr(harness.handle, {
      ctx: OWNER_CTX,
      repoId: REPO_A,
      prNumber: 8,
    });
    const operatorApp = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
      operatorToken: buildOperatorToken("ghp_OPERATOR_PAT"),
    });

    const res = await operatorApp.request(`/api/repos/${REPO_A}/pulls/8`, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });

    expect(res.status).toBe(200);
    expect(listCallTokens(listCallsPastGate(fake))).toEqual([ACCESS_TOKEN]);
    const row = await createTenantRepository(
      harness.handle,
      OWNER_CTX,
    ).pullRequests.getByNumber(brand(isRepoId, REPO_A), 8);
    expect(row?.githubUnreachableAt).not.toBeNull();
  });

  it("meta: a briefed row GitHub never answered for is not behind", async () => {
    stubUrlWorld();
    fake.failOn("readPullRequestFacts", FakeFailures.SERVER_ERROR);
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, {
      ctx: OWNER_CTX,
      repoId: REPO_A,
      prNumber: 8,
    });
    await writeOwnerBrief(pr.id, "head-1", 1);

    expect(await readBehind(cookie)).toBe(false);
  });

  it("meta: names the wait debouncing while the job start is ahead", async () => {
    stubGate();
    const cookie = await signIn();
    await triggerPendingBrief(WAIT_DEBOUNCE_SECONDS);

    const { text, body } = await readGenerationSummary(
      `/api/repos/${REPO_A}/pulls/7`,
      cookie,
    );

    expect(body.generation?.["waitReason"]).toBe(WaitReasons.DEBOUNCING);
    expect(text).not.toMatch(/run_?at/i);
  });

  it("meta: names the wait waiting-for-slot once the job is due", async () => {
    stubGate();
    const cookie = await signIn();
    await triggerPendingBrief(0);

    const { body } = await readGenerationSummary(
      `/api/repos/${REPO_A}/pulls/7`,
      cookie,
    );

    expect(body.generation?.["waitReason"]).toBe(WaitReasons.WAITING_FOR_SLOT);
  });

  it("meta: omits the wait reason once the generation runs", async () => {
    stubGate();
    const cookie = await signIn();
    const pr = await triggerPendingBrief(0);
    await claimTestRun(createGenerationProjection(harness.handle, CTX), {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head-1",
      baselineSha: null,
    });

    const { body } = await readGenerationSummary(
      `/api/repos/${REPO_A}/pulls/7`,
      cookie,
    );

    expect(body.generation).toMatchObject({
      status: GenerationStatuses.RUNNING,
    });
    expect(body.generation).not.toHaveProperty("waitReason");
  });

  it("meta: exposes draft status, author and authorship for an own draft", async () => {
    stubGate();
    // The seeded session's reviewer login is "octocat".
    const cookie = await signIn();
    await seedPr(harness.handle, {
      repoId: REPO_A,
      prNumber: 7,
      draft: true,
      authorLogin: "octocat",
    });

    const res = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["draft"]).toBe(true);
    expect(body["viewerIsAuthor"]).toBe(true);
    expect(body["authorLogin"]).toBe("octocat");
    expect(JSON.stringify(body)).not.toContain("author_login");
  });

  it("meta: carries the instance draftPolicy, default and injected", async () => {
    stubGate();
    const cookie = await signIn();
    await seedPr(harness.handle, {
      repoId: REPO_A,
      prNumber: 7,
      draft: true,
      authorLogin: "octocat",
    });

    // Default app (no draftPolicy dep) → the zero-config policy.
    const res = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["draftPolicy"]).toEqual({
      generate: true,
      debounceSeconds: null,
    });

    // Injected policy is echoed for the FE's copy states.
    const policyApp = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
      draftPolicy: { generate: false, debounceSeconds: 900 },
    });
    const policyRes = await policyApp.request(`/api/repos/${REPO_A}/pulls/7`, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(policyRes.status).toBe(200);
    const policyBody = (await policyRes.json()) as Record<string, unknown>;
    expect(policyBody["draftPolicy"]).toEqual({
      generate: false,
      debounceSeconds: 900,
    });
  });

  it("meta: denies viewer authorship for other or absent authors", async () => {
    stubGate();
    const cookie = await signIn();
    // Authored by someone else.
    await seedPr(harness.handle, {
      repoId: REPO_A,
      prNumber: 7,
      draft: true,
      authorLogin: "not-octocat",
    });
    const other = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(
      ((await other.json()) as Record<string, unknown>)["viewerIsAuthor"],
    ).toBe(false);

    // No stored author (null) must never match, not even a null viewer login.
    await seedPr(harness.handle, { repoId: REPO_A, prNumber: 8 });
    const noAuthor = await get(`/api/repos/${REPO_A}/pulls/8`, cookie);
    const noAuthorBody = (await noAuthor.json()) as Record<string, unknown>;
    expect(noAuthorBody["viewerIsAuthor"]).toBe(false);
    expect(noAuthorBody["authorLogin"]).toBeNull();
    expect(noAuthorBody["draft"]).toBe(false);
  });

  it("meta: caches push-derived viewerCanResolve with the positive gate", async () => {
    const counts = stubGate(true);
    const cookie = await signIn();
    // Not the author, capability comes from `permissions.push` alone.
    await seedPr(harness.handle, {
      repoId: REPO_A,
      prNumber: 7,
      authorLogin: "not-octocat",
    });

    const first = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as Record<string, unknown>;
    expect(firstBody["viewerCanResolve"]).toBe(true);
    expect(firstBody["viewerIsAuthor"]).toBe(false);
    expect(firstBody["appInstalled"]).toBe(true);

    // Second read inside the 60s TTL: NO second GitHub access check, the
    // capability must come from the positive-cache entry, not a re-fetch.
    const second = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(second.status).toBe(200);
    expect(
      ((await second.json()) as Record<string, unknown>)["viewerCanResolve"],
    ).toBe(true);
    expect(counts.repositoryReads()).toBe(1);
  });

  it("meta: viewerCanResolve=true for the PR author without push permission", async () => {
    stubGate(false);
    const cookie = await signIn();
    await seedPr(harness.handle, {
      repoId: REPO_A,
      prNumber: 7,
      authorLogin: "octocat",
    });

    const res = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["viewerCanResolve"]).toBe(true);
    expect(body["viewerIsAuthor"]).toBe(true);
  });

  it("meta: denies resolution without push or authorship, missing included", async () => {
    // No permissions block in the repo payload at all, must parse as no
    // capability, never as a grant.
    const counts = stubGate();
    const cookie = await signIn();
    await seedPr(harness.handle, {
      repoId: REPO_A,
      prNumber: 7,
      authorLogin: "not-octocat",
    });

    const res = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body["viewerCanResolve"]).toBe(false);

    // The cache-hit path must stay fail-closed too, a second read inside the
    // TTL (no re-fetch) may not invent a capability the check never saw.
    const second = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(second.status).toBe(200);
    expect(
      ((await second.json()) as Record<string, unknown>)["viewerCanResolve"],
    ).toBe(false);
    expect(counts.repositoryReads()).toBe(1);
  });

  it("meta: derives Previous Brief availability from marks and narratives", async () => {
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    const store = createArtifactStore(harness.handle, CTX);
    const write = async (head: string, index: number) => {
      const result = await store.briefs.write({
        pullRequestId: pr.id,
        baseSha: "base",
        headSha: head,
        headIndex: index,
        commitCount: index,
        provider: "anthropic",
        model: "claude",
        effort: "high",
        body: "{}",
      });
      return result;
    };
    await write("head-1", 1);
    const currentBrief = await write("head-2", 2);

    // No marks yet → previousBrief absent (fail closed).
    const before = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    const beforeBody = (await before.json()) as {
      comparisons?: { previousBrief?: unknown };
    };
    expect(beforeBody.comparisons?.previousBrief).toBeUndefined();

    // Marks for the previous-brief span → available, narrative not yet.
    const marks = await store.comparisonMarks.write({
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
    if (!marks.ok) {
      throw new Error("marks write failed");
    }
    const marked = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    const markedBody = (await marked.json()) as {
      comparisons?: { previousBrief?: unknown };
    };
    expect(markedBody.comparisons?.previousBrief).toEqual({
      baselineSha: "head-1",
      baselineIndex: 1,
      narrativeAvailable: false,
    });

    // Narrative lands → narrativeAvailable flips.
    await store.revisionNarratives.write({
      pullRequestId: pr.id,
      briefId: currentBrief.id,
      prevHeadSha: "head-1",
      headSha: "head-2",
      body: "{}",
      provider: "anthropic",
      model: "claude",
      effort: "high",
    });
    const full = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    const fullBody = (await full.json()) as {
      comparisons?: { previousBrief?: unknown };
    };
    expect(fullBody.comparisons?.previousBrief).toEqual({
      baselineSha: "head-1",
      baselineIndex: 1,
      narrativeAvailable: true,
    });
  });

  // ------------------------------------------------------ meta: lastReview

  interface MetaComparisons {
    comparisons?: { lastReview?: Record<string, unknown> };
  }

  async function metaLastReview(
    cookie: string,
  ): Promise<Record<string, unknown> | undefined> {
    const res = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as MetaComparisons;
    return body.comparisons?.lastReview;
  }

  async function seedCheckpoint(
    pullRequestId: Parameters<
      ReturnType<typeof createTenantRepository>["checkpoints"]["get"]
    >[0],
    reviewerId: number,
    lastSubmittedSha: string,
    ctx: TenantContext = CTX,
  ): Promise<void> {
    await createTenantRepository(
      harness.handle,
      ctx,
    ).checkpoints.upsertOnSubmit({
      pullRequestId,
      reviewerId: brand(isReviewerId, reviewerId),
      reviewerLogin: `reviewer-${reviewerId}`,
      lastSubmittedSha,
      submittedAt: new Date("2026-07-01T00:00:00Z"),
    });
  }

  async function seedBriefs(pr: {
    id: Parameters<
      ReturnType<typeof createArtifactStore>["briefs"]["listForPullRequest"]
    >[0];
  }): Promise<void> {
    const store = createArtifactStore(harness.handle, CTX);
    for (const [head, index] of [
      ["head-1", 1],
      ["head-2", 2],
    ] as const) {
      await store.briefs.write({
        pullRequestId: pr.id,
        baseSha: "base",
        headSha: head,
        headIndex: index,
        commitCount: index,
        provider: "anthropic",
        model: "claude",
        effort: "high",
        body: "{}",
      });
    }
  }

  it("meta: omits lastReview without the current reviewer's checkpoint", async () => {
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    await seedBriefs(pr);

    expect(await metaLastReview(cookie)).toBeUndefined();

    // A DIFFERENT reviewer submitted, the session reviewer still has nothing.
    await seedCheckpoint(pr.id, 999, "head-1");
    expect(await metaLastReview(cookie)).toBeUndefined();
  });

  it("meta: lastReview available tiers, marks+delta, then marks-only", async () => {
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    await seedBriefs(pr);
    await seedCheckpoint(pr.id, REVIEWER_ID, "head-1");
    const store = createArtifactStore(harness.handle, CTX);

    const marks = await store.comparisonMarks.write({
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
    if (!marks.ok) {
      throw new Error("marks write failed");
    }

    // Marks-only: an OFFER with the delta core absent.
    expect(await metaLastReview(cookie)).toEqual({
      deltaAvailable: false,
      baselineSha: "head-1",
      baselineIndex: 1,
    });

    await store.deltas.write({
      pullRequestId: pr.id,
      baselineSha: "head-1",
      headSha: "head-2",
      provider: "anthropic",
      model: "claude",
      effort: "high",
      body: "{}",
    });

    expect(await metaLastReview(cookie)).toEqual({
      deltaAvailable: true,
      baselineSha: "head-1",
      baselineIndex: 1,
    });
  });

  it("meta: lastReview unavailable reasons, pending vs baseline-unavailable", async () => {
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    await seedBriefs(pr);
    // Checkpoint SHA that was never briefed (rewritten history), no marks.
    await seedCheckpoint(pr.id, REVIEWER_ID, "gone-sha");

    expect(await metaLastReview(cookie)).toEqual({
      unavailable: "baseline-unavailable",
    });

    // A non-terminal delta generation for the exact span flips it to pending.
    const gen = createGenerationProjection(harness.handle, CTX);
    await gen.upsertPending({
      pullRequestId: pr.id,
      kind: GenerationKinds.DELTA,
      headSha: "head-2",
      baselineSha: "gone-sha",
    });
    expect(await metaLastReview(cookie)).toEqual({ unavailable: "pending" });

    // Terminal failure → back to baseline-unavailable (nothing is coming).
    const failed = await gen.markFailed(
      {
        pullRequestId: pr.id,
        kind: GenerationKinds.DELTA,
        headSha: "head-2",
        baselineSha: "gone-sha",
      },
      {
        code: GenerationFailureCodes.UNKNOWN,
        params: { detail: "span diff unavailable" },
      },
    );
    if (!failed.ok) {
      throw new Error("generation transition failed");
    }
    expect(await metaLastReview(cookie)).toEqual({
      unavailable: "baseline-unavailable",
    });
  });

  it("meta: marks lastReview pending while the current brief warms", async () => {
    // Production writes no delta-kind projection rows (warmDeltaCores runs
    // inside the brief job): while that job is non-terminal and marks are
    // absent, the reason must be pending, NOT baseline-unavailable.
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    await seedBriefs(pr);
    await seedCheckpoint(pr.id, REVIEWER_ID, "head-1");

    const gen = createGenerationProjection(harness.handle, CTX);
    await gen.upsertPending({
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head-2",
      baselineSha: null,
    });
    expect(await metaLastReview(cookie)).toEqual({ unavailable: "pending" });

    // Brief job finished, still no marks → nothing is coming for this span.
    await succeedTestRun(gen, {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head-2",
      baselineSha: null,
    });
    expect(await metaLastReview(cookie)).toEqual({
      unavailable: "baseline-unavailable",
    });
  });

  it("meta: omits lastReview for a checkpoint at the current head", async () => {
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    await seedBriefs(pr);
    await seedCheckpoint(pr.id, REVIEWER_ID, "head-2");
    expect(await metaLastReview(cookie)).toBeUndefined();
  });

  it("meta: lastReview never leaks a cross-tenant checkpoint", async () => {
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    await seedBriefs(pr);
    // Same reviewer id, same PR number, but the OTHER tenant's PR row.
    const otherPr = await seedPr(harness.handle, {
      ctx: OTHER_CTX,
      repoId: REPO_A,
      prNumber: 7,
    });
    await seedCheckpoint(otherPr.id, REVIEWER_ID, "head-1", OTHER_CTX);

    expect(await metaLastReview(cookie)).toBeUndefined();
  });

  // ----------------------------------------------------- meta: revisions[]

  async function metaBody(cookie: string): Promise<MetaRevisionsBody> {
    const res = await get(`/api/repos/${REPO_A}/pulls/7`, cookie);
    expect(res.status).toBe(200);
    const raw: unknown = await res.json();
    if (!isMetaRevisionsBody(raw)) {
      throw new Error("PR-meta body failed the revisions shape guard");
    }
    return raw;
  }

  /** Write a brief with its OWN base (base drift across revisions). */
  async function writeBrief(
    prId: Parameters<
      ReturnType<typeof createArtifactStore>["briefs"]["listForPullRequest"]
    >[0],
    base: string,
    head: string,
    index: number,
  ): Promise<void> {
    await createArtifactStore(harness.handle, CTX).briefs.write({
      pullRequestId: prId,
      baseSha: base,
      headSha: head,
      headIndex: index,
      commitCount: index,
      provider: "anthropic",
      model: "claude",
      effort: "high",
      body: "{}",
    });
  }

  it("meta: lists revisions by headIndex only once a brief exists", async () => {
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });

    // No brief yet → no revisions key at all.
    const gen = createGenerationProjection(harness.handle, CTX);
    await gen.upsertPending({
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head-1",
      baselineSha: null,
    });
    const early = await metaBody(cookie);
    expect(early.briefAvailable).toBe(false);
    expect(early.revisions).toBeUndefined();

    // Three briefed heads, each with its OWN drifting base.
    await writeBrief(pr.id, "base-a", "head-1", 1);
    await writeBrief(pr.id, "base-b", "head-2", 2);
    await writeBrief(pr.id, "base-c", "head-3", 3);
    await gen.upsertPending({
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head-3",
      baselineSha: null,
    });

    const body = await metaBody(cookie);
    expect(
      body.revisions?.map((r) => [r.headIndex, r.headSha, r.baseSha]),
    ).toEqual([
      [1, "head-1", "base-a"],
      [2, "head-2", "base-b"],
      [3, "head-3", "base-c"],
    ]);
    // Each entry carries serialized createdAt/generatedAt timestamps.
    for (const rev of body.revisions ?? []) {
      expect(typeof rev.createdAt).toBe("string");
      expect(Number.isNaN(Date.parse(rev.createdAt))).toBe(false);
      expect(Number.isNaN(Date.parse(rev.generatedAt))).toBe(false);
    }
    // generatedAt is the generation row's created_at: head-1 was
    // enqueued BEFORE its brief artifact was written, so its cutoff is never
    // later than the artifact write; head-2 has no projection row and falls
    // back to the artifact's own createdAt.
    const [rev1, rev2] = body.revisions ?? [];
    if (rev1 === undefined || rev2 === undefined) {
      throw new Error("revisions missing");
    }
    expect(Date.parse(rev1.generatedAt)).toBeLessThanOrEqual(
      Date.parse(rev1.createdAt),
    );
    expect(rev2.generatedAt).toBe(rev2.createdAt);
  });

  it("meta: keeps stored revisions while a newer head is pending", async () => {
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    await writeBrief(pr.id, "base-a", "head-1", 1);
    const gen = createGenerationProjection(harness.handle, CTX);
    await gen.upsertPending({
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head-2",
      baselineSha: null,
    });

    const body = await metaBody(cookie);

    expect(body.briefAvailable).toBe(false);
    expect(body).toMatchObject({ headSha: "head-2", comparisons: {} });
    expect(
      body.revisions?.map((revision) => [revision.headIndex, revision.headSha]),
    ).toEqual([[1, "head-1"]]);
  });

  it("meta: per-revision previousBrief joins consecutive briefed pairs only", async () => {
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    const store = createArtifactStore(harness.handle, CTX);
    await writeBrief(pr.id, "base", "head-1", 1);
    await writeBrief(pr.id, "base", "head-2", 2);
    await writeBrief(pr.id, "base", "head-3", 3);

    // Marks for the (head-2 → head-3) span only.
    const marks = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        baselineSha: "head-2",
        headSha: "head-3",
        files: [
          {
            file: "src/a.ts",
            addedRanges: [{ start: 1, end: 2 }],
            removedRanges: [],
          },
        ],
      },
    });
    if (!marks.ok) {
      throw new Error("marks write failed");
    }

    const body = await metaBody(cookie);
    const byHead = new Map((body.revisions ?? []).map((r) => [r.headSha, r]));
    // head-1: no previous head → no previousBrief.
    expect(byHead.get("head-1")?.comparisons.previousBrief).toBeUndefined();
    // head-2: previous = head-1, but no marks → absent (fail closed).
    expect(byHead.get("head-2")?.comparisons.previousBrief).toBeUndefined();
    // head-3: previous = head-2, marks exist → offered, narrative not yet.
    expect(byHead.get("head-3")?.comparisons.previousBrief).toEqual({
      baselineSha: "head-2",
      baselineIndex: 2,
      narrativeAvailable: false,
    });
  });

  it("meta: offers forward-span lastReview even with marks only", async () => {
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    const store = createArtifactStore(harness.handle, CTX);
    await writeBrief(pr.id, "base", "head-1", 1);
    await writeBrief(pr.id, "base", "head-2", 2);
    await writeBrief(pr.id, "base", "head-3", 3);
    // The reviewer last submitted at head-2.
    await seedCheckpoint(pr.id, REVIEWER_ID, "head-2");

    // Forward marks (head-2 → head-3) exist; the backward span never will.
    const marks = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        baselineSha: "head-2",
        headSha: "head-3",
        files: [
          {
            file: "src/a.ts",
            addedRanges: [{ start: 1, end: 2 }],
            removedRanges: [],
          },
        ],
      },
    });
    if (!marks.ok) {
      throw new Error("marks write failed");
    }

    const body = await metaBody(cookie);
    const byHead = new Map((body.revisions ?? []).map((r) => [r.headSha, r]));
    // head-1 is BEFORE the checkpoint (backward span) → no marks → no offer.
    // Historical head with no marks and no active warming → baseline-unavailable.
    expect(byHead.get("head-1")?.comparisons.lastReview).toEqual({
      unavailable: "baseline-unavailable",
    });
    // head-2 IS the checkpoint (empty span) → nothing to explain.
    expect(byHead.get("head-2")?.comparisons.lastReview).toBeUndefined();
    // head-3: forward span with marks, delta core absent → marks-only offer.
    expect(byHead.get("head-3")?.comparisons.lastReview).toEqual({
      deltaAvailable: false,
      baselineSha: "head-2",
      baselineIndex: 2,
    });
  });

  it("meta: matches top-level comparisons to the latest revision's bytes", async () => {
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    const store = createArtifactStore(harness.handle, CTX);
    await writeBrief(pr.id, "base", "head-1", 1);
    await writeBrief(pr.id, "base", "head-2", 2);
    await seedCheckpoint(pr.id, REVIEWER_ID, "head-1");

    // Previous-brief marks + last-review marks both land on the latest span.
    const marks = await store.comparisonMarks.write({
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
    if (!marks.ok) {
      throw new Error("marks write failed");
    }

    const body = await metaBody(cookie);
    const latest = (body.revisions ?? []).find((r) => r.headSha === "head-2");
    // The top-level envelope IS the latest head's, same keys, same values.
    expect(body.comparisons).toEqual(latest?.comparisons);
    expect(body.comparisons).toEqual({
      previousBrief: {
        baselineSha: "head-1",
        baselineIndex: 1,
        narrativeAvailable: false,
      },
      lastReview: {
        deltaAvailable: false,
        baselineSha: "head-1",
        baselineIndex: 1,
      },
    });
  });

  it("meta: uses the current base's comparison when a head is rebriefed", async () => {
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    const store = createArtifactStore(harness.handle, CTX);

    // head-2 briefed (idx 1), head-3 briefed (idx 2), then a base retarget
    // re-briefs the SAME head-2 under a new base (idx 3), two revision rows
    // now share headSha "head-2". The current revision is idx 3.
    await writeBrief(pr.id, "base-a", "head-2", 1);
    await writeBrief(pr.id, "base-a", "head-3", 2);
    await writeBrief(pr.id, "base-b", "head-2", 3);

    // Marks for the current revision's previous-brief span (head-3 → head-2).
    const marks = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        baselineSha: "head-3",
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
    if (!marks.ok) {
      throw new Error("marks write failed");
    }

    const body = await metaBody(cookie);
    // Both duplicate-head entries are listed, each with its OWN base.
    expect(
      body.revisions?.map((r) => [r.headIndex, r.headSha, r.baseSha]),
    ).toEqual([
      [1, "head-2", "base-a"],
      [2, "head-3", "base-a"],
      [3, "head-2", "base-b"],
    ]);
    // The stale idx-1 entry has no previous head → no previousBrief.
    expect(body.revisions?.[0]?.comparisons.previousBrief).toBeUndefined();
    // The CURRENT (idx 3) entry's previous briefed head is head-3.
    const current = {
      baselineSha: "head-3",
      baselineIndex: 2,
      narrativeAvailable: false,
    };
    expect(body.revisions?.[2]?.comparisons.previousBrief).toEqual(current);
    // Top-level comparisons must be the CURRENT revision's, a headSha-only
    // match would pick the stale idx-1 duplicate and report no previousBrief.
    expect(body.comparisons).toEqual({ previousBrief: current });
  });

  it("meta: shares lastReview across revisions with the same head", async () => {
    // A checkpoint/head pair has the same marks across duplicate-head revisions.
    // Offer both even when the baseline brief index exceeds the earlier duplicate's index.
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    const store = createArtifactStore(harness.handle, CTX);

    await writeBrief(pr.id, "base-a", "head-2", 1);
    await writeBrief(pr.id, "base-a", "head-3", 2);
    await writeBrief(pr.id, "base-b", "head-2", 3);
    // The reviewer last submitted at head-3; the worker warmed the forward
    // span (head-3 -> head-2) for the current (rebriefed) revision.
    await seedCheckpoint(pr.id, REVIEWER_ID, "head-3");
    const marks = await store.comparisonMarks.write({
      pullRequestId: pr.id,
      marks: {
        baselineSha: "head-3",
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
    if (!marks.ok) {
      throw new Error("marks write failed");
    }

    const body = await metaBody(cookie);
    const expected = {
      deltaAvailable: false,
      baselineSha: "head-3",
      baselineIndex: 2,
    };
    // Both head-2 entries (idx 1 and idx 3) carry the identical offer.
    expect(body.revisions?.[0]?.comparisons.lastReview).toEqual(expected);
    expect(body.revisions?.[2]?.comparisons.lastReview).toEqual(expected);
    // The head-3 entry IS the checkpoint (empty span), nothing to explain.
    expect(body.revisions?.[1]?.comparisons.lastReview).toBeUndefined();
  });

  it("meta: marks duplicate-head lastReview pending while that head warms", async () => {
    // Pending is also a function of checkpoint/head, not revision-row identity.
    // A warming head's older duplicate must report pending before marks exist too.
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });

    await writeBrief(pr.id, "base-a", "head-2", 1);
    await writeBrief(pr.id, "base-a", "head-3", 2);
    await writeBrief(pr.id, "base-b", "head-2", 3);
    // Checkpoint SHA with no marks anywhere; the current head's BRIEF
    // generation is still warming (marks land before it succeeds).
    await seedCheckpoint(pr.id, REVIEWER_ID, "gone-sha");
    const gen = createGenerationProjection(harness.handle, CTX);
    await gen.upsertPending({
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head-2",
      baselineSha: null,
    });

    const warming = await metaBody(cookie);
    // Both head-2 entries (idx 1 and idx 3): identical pending state.
    expect(warming.revisions?.[0]?.comparisons.lastReview).toEqual({
      unavailable: "pending",
    });
    expect(warming.revisions?.[2]?.comparisons.lastReview).toEqual({
      unavailable: "pending",
    });
    // head-3 is historical (not the current head), never warming.
    expect(warming.revisions?.[1]?.comparisons.lastReview).toEqual({
      unavailable: "baseline-unavailable",
    });

    // Warming over, still no marks → all head-2 entries agree on unavailable.
    await succeedTestRun(gen, {
      pullRequestId: pr.id,
      kind: GenerationKinds.BRIEF,
      headSha: "head-2",
      baselineSha: null,
    });
    const settled = await metaBody(cookie);
    expect(settled.revisions?.[0]?.comparisons.lastReview).toEqual({
      unavailable: "baseline-unavailable",
    });
    expect(settled.revisions?.[2]?.comparisons.lastReview).toEqual({
      unavailable: "baseline-unavailable",
    });
  });

  it("meta: revisions never leak across tenants", async () => {
    stubGate();
    const cookie = await signIn();
    const pr = await seedPr(harness.handle, { repoId: REPO_A, prNumber: 7 });
    await writeBrief(pr.id, "base", "head-1", 1);

    // Another tenant's PR (same repo id + number) with its own briefs.
    const otherPr = await seedPr(harness.handle, {
      ctx: OTHER_CTX,
      repoId: REPO_A,
      prNumber: 7,
    });
    await createArtifactStore(harness.handle, OTHER_CTX).briefs.write({
      pullRequestId: otherPr.id,
      baseSha: "x",
      headSha: "other-head",
      headIndex: 9,
      commitCount: 1,
      provider: "anthropic",
      model: "claude",
      effort: "high",
      body: "{}",
    });

    const body = await metaBody(cookie);
    expect(body.revisions?.map((r) => r.headSha)).toEqual(["head-1"]);
  });
});
