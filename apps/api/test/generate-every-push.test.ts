// POST /api/repos/:repoId/pulls/:prNumber/generate-every-push/on and /off
// over PGlite: a pusher's per-PR switch from a signed-in browser. On releases
// a held head as a Generate click does; off leaves every head as it stands.
import { makeFakeGitHub, type FakeGitHub } from "github/testing";
import {
  createGenerationProjection,
  createIngestRoutines,
  createTenantRepository,
  type KeyProvider,
  type ScopeContext,
} from "persistence";
import { AccessLevels, GenerationStatuses, PrStates } from "types";
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

const REPO_ID = 424242;
const BRANDED_REPO_ID = brandRepoId(BigInt(REPO_ID));
const HEAD = "a".repeat(40);
const PULL_PATH = `/api/repos/${REPO_ID}/pulls/${PR_NUMBER}`;
const ON_PATH = `${PULL_PATH}/generate-every-push/on`;
const OFF_PATH = `${PULL_PATH}/generate-every-push/off`;
const TENANT: ScopeContext = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};

async function seedPendingHead(harness: SharedPglite) {
  const triggered = await createIngestRoutines(
    harness.handle,
    TENANT,
  ).triggerGeneration({
    pullRequest: {
      repoId: BRANDED_REPO_ID,
      prNumber: PR_NUMBER,
      repoSlug: REPO_SLUG,
      state: PrStates.OPEN,
    },
    headSha: HEAD,
    debounceSeconds: 0,
  });
  return triggered.pullRequest;
}

async function seedHeldHead(harness: SharedPglite): Promise<void> {
  const pr = await seedPendingHead(harness);
  const held = await createGenerationProjection(
    harness.handle,
    TENANT,
  ).markHeld(
    { pullRequestId: pr.id, kind: "brief", headSha: HEAD, baselineSha: null },
    [{ kind: "never", setBy: "repo" }],
  );
  if (!held.ok) {
    throw new Error("expected the head held");
  }
}

async function readSwitch(
  harness: SharedPglite,
): Promise<Record<string, unknown> | undefined> {
  const rows = await harness.raw(
    "select generate_every_push_by::text as by, generate_every_push_at is not null as on from pull_request",
  );
  return rows[0];
}

async function readHead(
  harness: SharedPglite,
): Promise<Record<string, unknown> | undefined> {
  const rows = await harness.raw(
    "select status, generate_requested_at is not null as stamped from generation",
  );
  return rows[0];
}

async function countGenerateJobs(harness: SharedPglite): Promise<number> {
  const rows = await harness.raw(
    "select count(*)::int as n from graphile_worker.jobs where task_identifier = 'generate'",
  );
  return Number(rows[0]?.["n"]);
}

async function readAuditRows(
  harness: SharedPglite,
): Promise<Record<string, unknown>[]> {
  return harness.raw(
    "select operation, outcome, target_type from audit_log order by id",
  );
}

async function readCode(res: Response): Promise<unknown> {
  const body: unknown = await res.json();
  if (typeof body !== "object" || body === null || !("code" in body)) {
    return undefined;
  }
  return body.code;
}

describe("POST /api/repos/:repoId/pulls/:prNumber/generate-every-push", () => {
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

  async function signIn(): Promise<Record<string, string>> {
    const { cookie } = await seedSignIn(harness.handle, kp);
    return {
      ...SAME_ORIGIN_HEADERS,
      Cookie: `__Host-mergebrief_session=${cookie}`,
    };
  }

  async function postAsCookie(path: string): Promise<Response> {
    return app.request(path, { method: "POST", headers: await signIn() });
  }

  it("turns it on and releases the held head with its job queued", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHeldHead(harness);

    const res = await postAsCookie(ON_PATH);

    expect(res.status).toBe(204);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await readSwitch(harness)).toEqual({
      by: String(REVIEWER_ID),
      on: true,
    });
    expect(await readHead(harness)).toEqual({
      status: GenerationStatuses.PENDING,
      stamped: true,
    });
    expect(await countGenerateJobs(harness)).toBe(1);
  });

  it("writes an audit row naming the operation and the pull request", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedPendingHead(harness);

    await postAsCookie(ON_PATH);
    await postAsCookie(OFF_PATH);

    expect(await readAuditRows(harness)).toEqual([
      {
        operation: "turn-on-generate-every-push",
        outcome: "ok",
        target_type: "pull_request",
      },
      {
        operation: "turn-off-generate-every-push",
        outcome: "ok",
        target_type: "pull_request",
      },
    ]);
  });

  it("shows the switch on the PR meta once it is on", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedPendingHead(harness);
    const headers = await signIn();

    const before = await app.request(PULL_PATH, { headers });
    await app.request(ON_PATH, { method: "POST", headers });
    const after = await app.request(PULL_PATH, { headers });

    expect(await before.json()).toMatchObject({ generateEveryPush: false });
    expect(await after.json()).toMatchObject({ generateEveryPush: true });
  });

  it("turns it off and leaves the released head and its job alone", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHeldHead(harness);
    await postAsCookie(ON_PATH);

    const res = await postAsCookie(OFF_PATH);

    expect(res.status).toBe(204);
    expect(await readSwitch(harness)).toEqual({ by: null, on: false });
    expect(await readHead(harness)).toEqual({
      status: GenerationStatuses.PENDING,
      stamped: true,
    });
    expect(await countGenerateJobs(harness)).toBe(1);
  });

  it.each([
    ["on", ON_PATH],
    ["off", OFF_PATH],
  ])("refuses a Bearer token turning it %s as human-only", async (_, path) => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHeldHead(harness);
    const token = await seedApiToken(
      harness.handle,
      kp,
      AccessLevels.EXTERNAL_WRITE,
    );

    const res = await app.request(path, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(403);
    expect(await readCode(res)).toBe("human-only");
    expect(await readSwitch(harness)).toEqual({ by: null, on: false });
    expect((await readHead(harness))?.["status"]).toBe(GenerationStatuses.HELD);
  });

  it.each([
    ["on", ON_PATH],
    ["off", OFF_PATH],
  ])(
    "answers 404 to a viewer without push access turning it %s",
    async (_, path) => {
      arrangeFakeGate(fake, { repoId: REPO_ID, push: false });
      await seedHeldHead(harness);

      const res = await postAsCookie(path);

      expect(res.status).toBe(404);
      expect(await readSwitch(harness)).toEqual({ by: null, on: false });
      expect((await readHead(harness))?.["status"]).toBe(
        GenerationStatuses.HELD,
      );
    },
  );

  it("turns it on only on push access GitHub confirms now", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID });
    await seedHeldHead(harness);
    const headers = await signIn();
    const read = await app.request(PULL_PATH, { headers });
    expect(read.status).toBe(200);
    fake.addRepository({
      repoId: BRANDED_REPO_ID,
      fullName: REPO_SLUG,
      private: true,
      viewerCanPush: false,
      viewerIsAdmin: false,
    });

    const res = await app.request(ON_PATH, { method: "POST", headers });

    expect(res.status).toBe(404);
    expect(await readSwitch(harness)).toEqual({ by: null, on: false });
    expect((await readHead(harness))?.["status"]).toBe(GenerationStatuses.HELD);
  });

  it("answers 404 for a repository in no installation", async () => {
    arrangeFakeGate(fake, { repoId: REPO_ID, inInstallation: false });
    await createTenantRepository(harness.handle, TENANT).pullRequests.upsert({
      repoId: BRANDED_REPO_ID,
      prNumber: PR_NUMBER,
      repoSlug: REPO_SLUG,
      state: PrStates.OPEN,
    });

    const res = await postAsCookie(ON_PATH);

    expect(res.status).toBe(404);
    expect(await readSwitch(harness)).toEqual({ by: null, on: false });
  });
});
