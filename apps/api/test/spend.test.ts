// GET /api/spend over PGlite: the Instance's started runs today against the
// daily cap, for its Operators only.
import { ApiErrorCodes } from "contract";
import {
  createGenerationProjection,
  createIngestRoutines,
  type KeyProvider,
  type TenantContext,
} from "persistence";
import {
  claimTestRun,
  createPgliteHarness,
  type PgliteHarness,
} from "persistence/testing";
import { AccessLevels, PrStates } from "types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger } from "./logging";
import {
  INSTALLATION_ID,
  REVIEWER_ID,
  SECRET,
  brandInstallationId,
  brandRepoId,
  buildAuthDeps,
  createKeyProvider,
} from "./fixtures";
import { UNUSED_INSTALLATION_DEPS } from "./reviewer-github";
import { seedApiToken, seedSignIn } from "./sign-in";

const PATH = "/api/spend";
const DAILY_CAP = 50;
const MS_PER_DAY = 86_400_000;
const OPERATOR_IDS: ReadonlySet<bigint> = new Set([BigInt(REVIEWER_ID)]);

const CTX: TenantContext = {
  installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
};

interface AppOptions {
  readonly operatorIds?: ReadonlySet<bigint>;
  readonly cap?: number | null;
}

describe("GET /api/spend", () => {
  let harness: PgliteHarness;
  let kp: KeyProvider;

  beforeEach(async () => {
    harness = await createPgliteHarness();
    kp = createKeyProvider();
  });

  afterEach(async () => {
    await harness.close();
  });

  function buildApp(options: AppOptions): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(kp),
      operatorIds: options.operatorIds ?? OPERATOR_IDS,
      spendPolicy: { maxGenerationsPerDay: options.cap ?? null },
      ...UNUSED_INSTALLATION_DEPS,
    });
  }

  async function startRuns(count: number): Promise<void> {
    const triggered = await createIngestRoutines(
      harness.handle,
      CTX,
    ).triggerGeneration({
      pullRequest: {
        repoId: brandRepoId(1n),
        prNumber: 1,
        state: PrStates.OPEN,
      },
      headSha: "h1",
      debounceSeconds: 0,
    });
    const projection = createGenerationProjection(harness.handle, CTX);
    const target = {
      pullRequestId: triggered.pullRequest.id,
      kind: "brief",
      headSha: "h1",
      baselineSha: null,
    } as const;
    for (let run = 0; run < count; run += 1) {
      await claimTestRun(projection, target, { leaseMs: 0 });
    }
  }

  async function readAsCookie(app: ApiApp): Promise<Response> {
    const { cookie } = await seedSignIn(harness.handle, kp);
    return app.request(PATH, {
      headers: { Cookie: `__Host-mergebrief_session=${cookie}` },
    });
  }

  it("answers an Operator today's started runs against the cap", async () => {
    await startRuns(2);

    const res = await readAsCookie(buildApp({ cap: DAILY_CAP }));

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body: unknown = await res.json();
    expect(body).toMatchObject({ startedRuns: 2, cap: DAILY_CAP });
  });

  it("names the UTC day the count covers and when it resets", async () => {
    const res = await readAsCookie(buildApp({ cap: DAILY_CAP }));
    const { dayStartedAt, resetsAt } = (await res.json()) as {
      dayStartedAt: string;
      resetsAt: string;
    };
    const start = new Date(dayStartedAt);

    expect(start.toISOString()).toBe(dayStartedAt);
    expect(start.getUTCHours()).toBe(0);
    const dayLength = new Date(resetsAt).getTime() - start.getTime();
    expect(dayLength).toBe(MS_PER_DAY);
  });

  it("leaves the cap out on an uncapped Instance", async () => {
    const res = await readAsCookie(buildApp({ cap: null }));

    expect(await res.json()).not.toHaveProperty("cap");
  });

  it("answers an Operator on an API token", async () => {
    const token = await seedApiToken(harness.handle, kp, AccessLevels.READ);

    const res = await buildApp({}).request(PATH, {
      headers: { Authorization: `Bearer ${token}` },
    });

    expect(res.status).toBe(200);
  });

  it("refuses a viewer the config does not list with 403 operator-only", async () => {
    const app = buildApp({ operatorIds: new Set([9919n]) });
    const res = await readAsCookie(app);

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      code: ApiErrorCodes.OPERATOR_ONLY,
    });
  });

  it("answers 401 without a session", async () => {
    const res = await buildApp({}).request(PATH);

    expect(res.status).toBe(401);
  });
});
