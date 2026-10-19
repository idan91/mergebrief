// GET /api/repos/:repoId/pulls/:prNumber/generation over PGlite: the current
// head's claims against the claim limit, its last stored failure, and the
// takeover job's state.
import { makeFakeGitHub, type FakeGitHub } from "github/testing";
import {
  createGenerationProjection,
  createIngestRoutines,
  createTenantRepository,
  type KeyProvider,
  type TenantContext,
} from "persistence";
import {
  claimTestRun,
  createPgliteHarness,
  type PgliteHarness,
} from "persistence/testing";
import {
  GenerationFailureCodes,
  GenerationStatuses,
  PrStates,
  QueueTasks,
  TakeoverJobStates,
} from "types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger } from "./logging";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  SECRET,
  brandInstallationId,
  brandRepoId,
  createKeyProvider,
} from "./fixtures";
import {
  UNUSED_INSTALLATION_DEPS,
  arrangeFakeGate,
  buildFakeAuthDeps,
} from "./reviewer-github";
import { seedSignIn } from "./sign-in";

const REPO_A = 424242;
const HEAD = "head-1";
const CLAIM_LIMIT = 3;
const TAKEOVER_DELAY_SECONDS = 125;
const PATH = `/api/repos/${REPO_A}/pulls/${PR_NUMBER}/generation`;

const REPO_ID = brandRepoId(BigInt(REPO_A));

const CTX: TenantContext = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};

describe("GET /api/repos/:repoId/pulls/:prNumber/generation", () => {
  let harness: PgliteHarness;
  let app: ApiApp;
  let kp: KeyProvider;
  let fake: FakeGitHub;
  let cookie: string;

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
    arrangeFakeGate(fake, {
      repoId: REPO_A,
      fullName: "octo/hello",
      push: false,
    });
    ({ cookie } = await seedSignIn(harness.handle, kp));
  });

  afterEach(async () => {
    await harness.close();
  });

  async function readClaims(): Promise<Record<string, unknown>> {
    const res = await app.request(PATH, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) {
      throw new Error("expected an object body");
    }
    return { ...body };
  }

  async function triggerHead() {
    const triggered = await createIngestRoutines(
      harness.handle,
      CTX,
    ).triggerGeneration({
      pullRequest: {
        repoId: REPO_ID,
        prNumber: PR_NUMBER,
        state: PrStates.OPEN,
      },
      headSha: HEAD,
      debounceSeconds: 0,
    });
    const pullRequestId = triggered.pullRequest.id;
    const projection = createGenerationProjection(harness.handle, CTX);
    const target = {
      pullRequestId,
      kind: "brief",
      headSha: HEAD,
      baselineSha: null,
    } as const;
    return { pullRequestId, projection, target };
  }

  it("reads a fresh head as no claims against the limit", async () => {
    await triggerHead();

    const body = await readClaims();

    expect(body).toStrictEqual({
      generation: {
        headSha: HEAD,
        status: GenerationStatuses.PENDING,
        claims: 0,
        claimLimit: CLAIM_LIMIT,
        exhausted: false,
      },
    });
  });

  it("reads an exhausted head and keeps its earlier failure code", async () => {
    const { projection, target } = await triggerHead();
    for (let claim = 0; claim < CLAIM_LIMIT; claim += 1) {
      await claimTestRun(projection, target, { leaseMs: 0 });
    }
    await projection.markFailed(target, {
      code: GenerationFailureCodes.PROVIDER_TIMEOUT,
    });

    const body = await readClaims();

    expect(body["generation"]).toMatchObject({
      status: GenerationStatuses.FAILED,
      claims: CLAIM_LIMIT,
      exhausted: true,
      errorCode: GenerationFailureCodes.PROVIDER_TIMEOUT,
    });
  });

  it("reads a waiting takeover job with its start time", async () => {
    const { pullRequestId } = await triggerHead();
    await harness.raw(
      "select graphile_worker.add_job($1, '{}'::json, $2, now() + make_interval(secs => $3))",
      [
        QueueTasks.RECOVER_GENERATION,
        `${QueueTasks.RECOVER_GENERATION}:${pullRequestId}:${HEAD}`,
        TAKEOVER_DELAY_SECONDS,
      ],
    );

    const body = await readClaims();
    const generation = body["generation"];

    expect(generation).toMatchObject({
      takeover: { state: TakeoverJobStates.SCHEDULED },
    });
    expect(JSON.stringify(generation)).toMatch(/"runsAt":"\d{4}-\d{2}-\d{2}T/);
  });

  it("answers no generation for a stored pull request never briefed", async () => {
    await createTenantRepository(harness.handle, CTX).pullRequests.upsert({
      repoId: REPO_ID,
      prNumber: PR_NUMBER,
      state: PrStates.OPEN,
    });

    expect(await readClaims()).toStrictEqual({});
  });
});
