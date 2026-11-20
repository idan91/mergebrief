// POST /api/repos/:repoId/pulls/:prNumber/regenerate over PGlite: a pusher's
// fresh run of the current head when it failed in a way a rerun can help, or
// when it awaits its Trigger approval.
import { FakeFailures, makeFakeGitHub, type FakeGitHub } from "github/testing";
import {
  createArtifactStore,
  createGenerationProjection,
  createIngestRoutines,
  createTenantRepository,
  type GenerationFailure,
  type KeyProvider,
  type ScopeContext,
} from "persistence";
import { claimTestRun, failTestRun, succeedTestRun } from "persistence/testing";
import {
  AccessLevels,
  GenerationFailureCodes,
  GenerationStatuses,
  PrStates,
} from "types";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger } from "./logging";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  REVIEWER_ID,
  SAME_ORIGIN_HEADERS,
  SECRET,
  brandInstallationId,
  brandRepoId,
  createKeyProvider,
} from "./fixtures";
import {
  LISTED_REVIEWER_DEPS,
  UNUSED_INSTALLATION_DEPS,
  arrangeFakeGate,
  buildFakeAuthDeps,
} from "./reviewer-github";
import { seedApiToken, seedSignIn } from "./sign-in";
import { registerSharedPglite, type SharedPglite } from "./shared-pglite";
import { STORED_BODY_VERSION } from "brief-core/artifact";

const REPO_ID = 424242;
const BRANDED_REPO_ID = brandRepoId(BigInt(REPO_ID));
const HEAD = "a".repeat(40);
const BASE = "c".repeat(40);
const NEXT_HEAD = "b".repeat(40);
const PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}/regenerate`;
const TENANT: ScopeContext = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};
const TIMEOUT: GenerationFailure = {
  code: GenerationFailureCodes.PROVIDER_TIMEOUT,
};

type SeededHead = "failed" | "running" | "succeeded";

async function seedHead(
  harness: SharedPglite,
  ctx: ScopeContext,
  state: SeededHead,
  failure: GenerationFailure = TIMEOUT,
): Promise<void> {
  const pr = await createTenantRepository(
    harness.handle,
    ctx,
  ).pullRequests.upsert({
    repoId: BRANDED_REPO_ID,
    prNumber: PR_NUMBER,
    repoSlug: REPO_SLUG,
    state: PrStates.OPEN,
  });
  const gen = createGenerationProjection(harness.handle, ctx);
  const target = {
    pullRequestId: pr.id,
    kind: "brief",
    headSha: HEAD,
    baselineSha: null,
  } as const;
  await gen.upsertPending(target);
  if (state === "succeeded") {
    await succeedTestRun(gen, target);
    return;
  }
  if (state === "failed") {
    await failTestRun(gen, target, failure);
    return;
  }
  await claimTestRun(gen, target);
}

/** A head the webhook's author gate left waiting for a Trigger approval. */
async function seedAwaitingHead(
  harness: SharedPglite,
  headSha = HEAD,
): Promise<void> {
  await createIngestRoutines(harness.handle, TENANT).triggerGeneration({
    pullRequest: {
      repoId: BRANDED_REPO_ID,
      prNumber: PR_NUMBER,
      repoSlug: REPO_SLUG,
      state: PrStates.OPEN,
    },
    headSha,
    debounceSeconds: 0,
    requiresTriggerApproval: true,
  });
}

/** The queued run takes the head's claim, as a worker does on pickup. */
async function claimSeededHead(harness: SharedPglite): Promise<void> {
  const pr = await createTenantRepository(
    harness.handle,
    TENANT,
  ).pullRequests.getByNumber(BRANDED_REPO_ID, PR_NUMBER);
  if (pr === undefined) {
    throw new Error("expected the seeded pull request");
  }
  const gen = createGenerationProjection(harness.handle, TENANT);
  await claimTestRun(gen, {
    pullRequestId: pr.id,
    kind: "brief",
    headSha: HEAD,
    baselineSha: null,
  });
}

async function readApproval(
  harness: SharedPglite,
): Promise<Record<string, unknown> | undefined> {
  const rows = await harness.raw(
    "select trigger_approved_by::text as by, trigger_approved_at is not null as approved from pull_request",
  );
  return rows[0];
}

async function readStatuses(harness: SharedPglite): Promise<string[]> {
  const rows = await harness.raw(
    "select status from generation order by triggered_at",
  );
  return rows.map((row) => String(row["status"]));
}

async function readGenerateJobs(
  harness: SharedPglite,
): Promise<Record<string, unknown>[]> {
  return harness.raw(
    "select key, payload->>'head_sha' as head from graphile_worker.jobs where task_identifier = 'generate'",
  );
}

async function readStatus(harness: SharedPglite): Promise<string> {
  const rows = await harness.raw("select status from generation");
  return String(rows[0]?.["status"]);
}

async function readCode(res: Response): Promise<unknown> {
  const body: unknown = await res.json();
  if (typeof body !== "object" || body === null || !("code" in body)) {
    return undefined;
  }
  return body.code;
}

/** The PR's current base and head have a brief stored. */
async function storeHeadBrief(harness: SharedPglite): Promise<void> {
  const pr = await createTenantRepository(
    harness.handle,
    TENANT,
  ).pullRequests.upsert({
    repoId: BRANDED_REPO_ID,
    prNumber: PR_NUMBER,
    state: PrStates.OPEN,
    baseSha: BASE,
  });
  await createArtifactStore(harness.handle, TENANT).briefs.write({
    pullRequestId: pr.id,
    baseSha: BASE,
    headSha: HEAD,
    headIndex: 1,
    commitCount: 1,
    provider: "anthropic",
    model: "opus",
    effort: "high",
    bodyVersion: STORED_BODY_VERSION,
    body: '{"v":"stored"}',
    usedGroupIds: [],
  });
}

describe("POST /api/repos/:repoId/pulls/:prNumber/regenerate", () => {
  const harness = registerSharedPglite();
  let app: ApiApp;
  let kp: KeyProvider;
  let fake: FakeGitHub;

  beforeEach(() => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
      ...LISTED_REVIEWER_DEPS,
    });
  });

  async function postAsToken(): Promise<Response> {
    const token = await seedApiToken(
      harness.handle,
      kp,
      AccessLevels.EXTERNAL_WRITE,
    );
    return app.request(PATH, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
  }

  async function postAsCookie(
    headers: Record<string, string> = SAME_ORIGIN_HEADERS,
  ): Promise<Response> {
    const { cookie } = await seedSignIn(harness.handle, kp);
    return app.request(PATH, {
      method: "POST",
      headers: { ...headers, Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("queues a failed head's job and answers 202 with no body", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHead(harness, TENANT, "failed");

    const res = await postAsCookie();

    expect(res.status).toBe(202);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.text()).toBe("");
    expect(await readStatus(harness)).toBe(GenerationStatuses.PENDING);
    const jobs = await readGenerateJobs(harness);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.["head"]).toBe(HEAD);
  });

  it("answers 404 to a viewer without push access", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, push: false });
    await seedHead(harness, TENANT, "failed");

    const res = await postAsCookie();

    expect(res.status).toBe(404);
    expect(await readStatus(harness)).toBe(GenerationStatuses.FAILED);
    expect(await readGenerateJobs(harness)).toHaveLength(0);
  });

  /** One session whose gate pass is cached, as a page that just read the PR holds it. */
  async function signInWithWarmGate(): Promise<Record<string, string>> {
    const { cookie } = await seedSignIn(harness.handle, kp);
    const headers = {
      ...SAME_ORIGIN_HEADERS,
      Cookie: `__Host-mergebrief_session=${cookie}`,
    };
    const read = await app.request(`/api/repos/${REPO_ID}/pulls/${PR_NUMBER}`, {
      headers,
    });
    expect(read.status).toBe(200);
    return headers;
  }

  it("reruns a failed head only on push access GitHub confirms now", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHead(harness, TENANT, "failed");
    const headers = await signInWithWarmGate();
    fake.addRepository({
      repoId: BRANDED_REPO_ID,
      fullName: REPO_SLUG,
      private: true,
      viewerCanPush: false,
      viewerIsAdmin: false,
    });

    const res = await app.request(PATH, { method: "POST", headers });

    expect(res.status).toBe(404);
    expect(await readStatus(harness)).toBe(GenerationStatuses.FAILED);
    expect(await readGenerateJobs(harness)).toHaveLength(0);
  });

  it("answers 502 when GitHub cannot confirm a rerun's push access", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHead(harness, TENANT, "failed");
    const headers = await signInWithWarmGate();
    fake.failOn("fetchRepositoryById", FakeFailures.SERVER_ERROR);

    const res = await app.request(PATH, { method: "POST", headers });

    expect(res.status).toBe(502);
    expect(await readStatus(harness)).toBe(GenerationStatuses.FAILED);
    expect(await readGenerateJobs(harness)).toHaveLength(0);
  });

  it("refuses a pusher on an account the instance does not list", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, accountId: 7070n });
    await seedHead(harness, TENANT, "failed");
    const listing = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
      ...LISTED_REVIEWER_DEPS,
      allowedAccess: { users: new Set(), accounts: new Set([9919n]) },
    });
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await listing.request(PATH, {
      method: "POST",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: `__Host-mergebrief_session=${cookie}`,
      },
    });

    expect(res.status).toBe(403);
    expect(await readCode(res)).toBe("account-not-allowed");
    expect(await readGenerateJobs(harness)).toEqual([]);
    expect(await readStatus(harness)).toBe(GenerationStatuses.FAILED);
  });

  it("reruns for a pusher on a listed account", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, accountId: 9919n });
    await seedHead(harness, TENANT, "failed");
    const listing = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
      ...LISTED_REVIEWER_DEPS,
      allowedAccess: { users: new Set(), accounts: new Set([9919n]) },
    });
    const { cookie } = await seedSignIn(harness.handle, kp);

    const res = await listing.request(PATH, {
      method: "POST",
      headers: {
        ...SAME_ORIGIN_HEADERS,
        Cookie: `__Host-mergebrief_session=${cookie}`,
      },
    });

    expect(res.status).toBe(202);
  });

  it("answers 409 generation-held while a run holds the head", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHead(harness, TENANT, "running");

    const res = await postAsCookie();

    expect(res.status).toBe(409);
    expect(await readCode(res)).toBe("generation-held");
  });

  it("answers 409 generation-not-regenerable on a succeeded head", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHead(harness, TENANT, "succeeded");

    const res = await postAsCookie();

    expect(res.status).toBe(409);
    expect(await readCode(res)).toBe("generation-not-regenerable");
    expect(await readGenerateJobs(harness)).toHaveLength(0);
  });

  it("answers 409 generation-not-regenerable on a cannot-help failure", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHead(harness, TENANT, "failed", {
      code: GenerationFailureCodes.OUTPUT_SECRET,
    });

    const res = await postAsCookie();

    expect(res.status).toBe(409);
    expect(await readCode(res)).toBe("generation-not-regenerable");
    expect(await readGenerateJobs(harness)).toHaveLength(0);
  });

  it("answers 409 generation-not-regenerable on a merged PR's failed head", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHead(harness, TENANT, "failed");
    await createTenantRepository(harness.handle, TENANT).pullRequests.upsert({
      repoId: BRANDED_REPO_ID,
      prNumber: PR_NUMBER,
      state: PrStates.MERGED,
      closedAt: new Date(),
    });

    const res = await postAsCookie();

    expect(res.status).toBe(409);
    expect(await readCode(res)).toBe("generation-not-regenerable");
    expect(await readStatus(harness)).toBe(GenerationStatuses.FAILED);
    expect(await readGenerateJobs(harness)).toHaveLength(0);
  });

  it("answers 409 generation-not-regenerable on a head with a stored brief", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHead(harness, TENANT, "failed");
    await storeHeadBrief(harness);

    const res = await postAsCookie();

    expect(res.status).toBe(409);
    expect(await readCode(res)).toBe("generation-not-regenerable");
    expect(await readStatus(harness)).toBe(GenerationStatuses.FAILED);
    expect(await readGenerateJobs(harness)).toHaveLength(0);
  });

  it("refuses a read-scoped Bearer token as scope-exceeded", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHead(harness, TENANT, "failed");
    const token = await seedApiToken(harness.handle, kp, AccessLevels.READ);

    const res = await app.request(PATH, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
    expect(await readCode(res)).toBe("scope-exceeded");
    expect(await readGenerateJobs(harness)).toHaveLength(0);
  });

  it("answers 401 to an anonymous caller without calling GitHub", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHead(harness, TENANT, "failed");

    const res = await app.request(PATH, {
      method: "POST",
      headers: SAME_ORIGIN_HEADERS,
    });

    expect(res.status).toBe(401);
    expect(fake.calls).toEqual([]);
    expect(await readStatus(harness)).toBe(GenerationStatuses.FAILED);
    expect(await readGenerateJobs(harness)).toHaveLength(0);
  });

  it("refuses a Bearer token below external-write as scope-exceeded", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHead(harness, TENANT, "failed");
    const token = await seedApiToken(
      harness.handle,
      kp,
      AccessLevels.PRIVATE_WRITE,
    );

    const res = await app.request(PATH, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
    expect(await readCode(res)).toBe("scope-exceeded");
    expect(await readGenerateJobs(harness)).toHaveLength(0);
  });

  it("refuses a cross-origin cookie POST", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHead(harness, TENANT, "failed");

    const res = await postAsCookie({ "sec-fetch-site": "cross-site" });

    expect(res.status).toBe(403);
    expect(await readGenerateJobs(harness)).toHaveLength(0);
  });

  it("approves an awaiting-trigger head for a pusher and queues its job", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedAwaitingHead(harness);

    const res = await postAsCookie();

    expect(res.status).toBe(202);
    expect(await readStatus(harness)).toBe(GenerationStatuses.PENDING);
    expect(await readApproval(harness)).toEqual({
      by: String(REVIEWER_ID),
      approved: true,
    });
    const jobs = await readGenerateJobs(harness);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.["head"]).toBe(HEAD);
  });

  it("answers 409 generation-held to a second click once the run holds it", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedAwaitingHead(harness);
    expect((await postAsCookie()).status).toBe(202);
    await claimSeededHead(harness);

    const res = await postAsCookie();

    expect(res.status).toBe(409);
    expect(await readCode(res)).toBe("generation-held");
  });

  it("answers 404 to a PR author without push and writes no approval", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, push: false });
    await seedAwaitingHead(harness);

    const res = await postAsCookie();

    expect(res.status).toBe(404);
    expect(await readStatus(harness)).toBe(GenerationStatuses.AWAITING_TRIGGER);
    expect(await readApproval(harness)).toEqual({ by: null, approved: false });
  });

  it("projects the approved PR's next gated push pending", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedAwaitingHead(harness);
    expect((await postAsCookie()).status).toBe(202);

    await seedAwaitingHead(harness, NEXT_HEAD);

    expect(await readStatuses(harness)).toEqual([
      GenerationStatuses.PENDING,
      GenerationStatuses.PENDING,
    ]);
  });

  it("approves only on push access GitHub confirms at the click", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedAwaitingHead(harness);
    const headers = await signInWithWarmGate();
    fake.addRepository({
      repoId: BRANDED_REPO_ID,
      fullName: REPO_SLUG,
      private: true,
      viewerCanPush: false,
      viewerIsAdmin: false,
    });

    const res = await app.request(PATH, { method: "POST", headers });

    expect(res.status).toBe(404);
    expect(await readStatus(harness)).toBe(GenerationStatuses.AWAITING_TRIGGER);
    expect(await readApproval(harness)).toEqual({ by: null, approved: false });
  });

  it("answers 502 when GitHub cannot confirm push access", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedAwaitingHead(harness);
    const headers = await signInWithWarmGate();
    fake.failOn("fetchRepositoryById", FakeFailures.SERVER_ERROR);

    const res = await app.request(PATH, { method: "POST", headers });

    expect(res.status).toBe(502);
    expect(await readApproval(harness)).toEqual({ by: null, approved: false });
  });

  it("refuses an API token on an awaiting-trigger head as human-only", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedAwaitingHead(harness);
    const jobsBefore = await harness.raw(
      "select key, run_at from graphile_worker.jobs order by id",
    );

    const res = await postAsToken();

    expect(res.status).toBe(403);
    expect(await readCode(res)).toBe("human-only");
    expect(await readStatus(harness)).toBe(GenerationStatuses.AWAITING_TRIGGER);
    expect(await readApproval(harness)).toEqual({ by: null, approved: false });
    expect(
      await harness.raw(
        "select key, run_at from graphile_worker.jobs order by id",
      ),
    ).toEqual(jobsBefore);
  });

  it("refuses an API token on an awaiting head without reading GitHub", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedAwaitingHead(harness);
    const token = await seedApiToken(
      harness.handle,
      kp,
      AccessLevels.EXTERNAL_WRITE,
    );
    const headers = { Authorization: `Bearer ${token}` };
    const read = await app.request(`/api/repos/${REPO_ID}/pulls/${PR_NUMBER}`, {
      headers,
    });
    expect(read.status).toBe(200);
    fake.failOn("fetchRepositoryById", FakeFailures.SERVER_ERROR);
    const callsBefore = fake.calls.length;

    const res = await app.request(PATH, { method: "POST", headers });

    expect(res.status).toBe(403);
    expect(await readCode(res)).toBe("human-only");
    expect(fake.calls).toHaveLength(callsBefore);
    expect(await readApproval(harness)).toEqual({ by: null, approved: false });
  });

  it("still regenerates a failed head for an API token", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHead(harness, TENANT, "failed");

    const res = await postAsToken();

    expect(res.status).toBe(202);
    expect(await readStatus(harness)).toBe(GenerationStatuses.PENDING);
    expect(await readGenerateJobs(harness)).toHaveLength(1);
    expect(await readApproval(harness)).toEqual({ by: null, approved: false });
  });
});
