// The scheduled session and credential sweep against a real migrated schema
// (the `persistence/testing` PGlite harness). Rows are seeded through
// persistence's own writes; GitHub's token endpoint is a stubbed global fetch.
import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createOAuthApp } from "github";
import { seedGrant } from "persistence/testing";
import {
  createEnvKeyProvider,
  createSessionAuth,
  createTokenAuth,
  isReviewerId,
  type GithubGrantRow,
  type ReviewerId,
} from "persistence";
import { AccessLevels } from "types/access-levels";
import { createLogger, type Logger } from "logging";
import {
  createSweepSessionsTask,
  type SweepSessionsTaskDeps,
} from "../src/task/sweep-sessions";
import { captureLogger } from "./generate/helpers";
import {
  openPerTestPglite,
  registerSharedPglite,
  type SharedPglite,
} from "./shared-pglite";

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const NO_CONTENT = 204;
const SERVER_ERROR = 500;
const ACCESS_TOKEN = "ghu_access";

function makeReviewerId(id: bigint): ReviewerId {
  if (!isReviewerId(id)) {
    throw new Error("not a reviewer id");
  }
  return id;
}

const KEY_REF = "SESSION_KEY_V1";
const KEY_PROVIDER = createEnvKeyProvider({
  [KEY_REF]: randomBytes(32).toString("base64"),
});

const REVIEWER = makeReviewerId(5001n);
const OTHER_REVIEWER = makeReviewerId(5002n);

function shiftNowByDays(days: number): Date {
  return new Date(Date.now() + days * MS_PER_DAY);
}

async function makeGrant(
  harness: SharedPglite,
  reviewerId: ReviewerId,
  refreshExpiresAt: Date,
): Promise<GithubGrantRow> {
  return seedGrant(harness.handle, {
    userId: reviewerId,
    accessToken: ACCESS_TOKEN,
    refreshToken: "ghr_refresh",
    keyProvider: KEY_PROVIDER,
    keyRef: KEY_REF,
    refreshExpiresAt,
  });
}

async function seedSession(
  harness: SharedPglite,
  hash: string,
  reviewerId: ReviewerId,
  expiresAt: Date,
): Promise<void> {
  const grant = await makeGrant(harness, reviewerId, expiresAt);
  await createSessionAuth(harness.handle).createSession({
    sessionTokenHash: hash,
    reviewerId,
    grantId: grant.id,
    expiresAt,
  });
}

async function makeRevokedTokenGrant(
  harness: SharedPglite,
  name = "revoked",
  revokedAt: Date = shiftNowByDays(-1),
): Promise<void> {
  const grant = await makeGrant(harness, REVIEWER, shiftNowByDays(30));
  const tokens = createTokenAuth(harness.handle);
  const minted = await tokens.mintToken({
    userId: REVIEWER,
    name,
    scope: AccessLevels.READ,
    tokenHash: name.padEnd(64, "0"),
    grantId: grant.id,
    expiresAt: null,
  });
  await tokens.revokeToken(REVIEWER, minted.id, revokedAt);
}

async function readSessionHashes(harness: SharedPglite): Promise<unknown[]> {
  const rows = await harness.raw(
    "select session_token_hash from auth_session order by id",
  );
  return rows.map((row) => row["session_token_hash"]);
}

async function countGrants(harness: SharedPglite): Promise<number> {
  return (await harness.raw("select id from github_grant")).length;
}

function makeSilentLogger(): Logger {
  return createLogger({ env: { LOG_LEVEL: "error" } });
}

function makeDeps(
  harness: SharedPglite,
  log: Logger = makeSilentLogger(),
  overrides: Partial<SweepSessionsTaskDeps> = {},
): SweepSessionsTaskDeps {
  return {
    handle: harness.handle,
    keyProvider: KEY_PROVIDER,
    oauthApp: createOAuthApp({
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
    }),
    log,
    ...overrides,
  };
}

function stubHangingFetch(
  _input: string | URL | Request,
  init?: RequestInit,
): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => {
      reject(init.signal?.reason);
    });
  });
}

function stubTokenDelete(status: number): ReturnType<typeof vi.fn> {
  const fetchFn = vi.fn(async () => {
    if (status === NO_CONTENT) {
      return new Response(null, { status });
    }
    return Response.json({ message: "refused" }, { status });
  });
  vi.stubGlobal("fetch", fetchFn);
  return fetchFn;
}

function readRevokedTokens(fetchFn: ReturnType<typeof vi.fn>): unknown[] {
  return fetchFn.mock.calls.map((call) => {
    const [, init] = call as [unknown, RequestInit?];
    return typeof init?.body === "string"
      ? JSON.parse(init.body).access_token
      : undefined;
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("sweep-sessions task", () => {
  const harness = registerSharedPglite();

  it("deletes expired sessions of every reviewer and keeps live ones", async () => {
    stubTokenDelete(NO_CONTENT);
    await seedSession(harness, "expired-a", REVIEWER, shiftNowByDays(-1));
    await seedSession(
      harness,
      "expired-b",
      OTHER_REVIEWER,
      shiftNowByDays(-30),
    );
    await seedSession(harness, "live", REVIEWER, shiftNowByDays(1));

    await createSweepSessionsTask(makeDeps(harness))();

    expect(await readSessionHashes(harness)).toEqual(["live"]);
    expect(await countGrants(harness)).toBe(1);
  });

  it("revokes at GitHub the token of each grant an expired session took", async () => {
    const fetchFn = stubTokenDelete(NO_CONTENT);
    await seedSession(harness, "expired", REVIEWER, shiftNowByDays(-1));

    await createSweepSessionsTask(makeDeps(harness))();

    expect(readRevokedTokens(fetchFn)).toEqual([ACCESS_TOKEN]);
  });

  it("deletes a grant only a revoked token holds and revokes it at GitHub", async () => {
    const fetchFn = stubTokenDelete(NO_CONTENT);
    await makeRevokedTokenGrant(harness);

    await createSweepSessionsTask(makeDeps(harness))();

    expect(await countGrants(harness)).toBe(0);
    expect(readRevokedTokens(fetchFn)).toEqual([ACCESS_TOKEN]);
  });

  it("deletes a grant no row referenced for a day and revokes its token", async () => {
    const fetchFn = stubTokenDelete(NO_CONTENT);
    await makeGrant(harness, REVIEWER, shiftNowByDays(30));
    await harness.raw(
      "update github_grant set created_at = now() - interval '2 days'",
    );

    await createSweepSessionsTask(makeDeps(harness))();

    expect(await countGrants(harness)).toBe(0);
    expect(readRevokedTokens(fetchFn)).toEqual([ACCESS_TOKEN]);
  });

  it("revokes a grant once when both sweeps return it", async () => {
    const fetchFn = stubTokenDelete(NO_CONTENT);
    const grant = await makeGrant(harness, REVIEWER, shiftNowByDays(30));
    await createSessionAuth(harness.handle).createSession({
      sessionTokenHash: "expired",
      reviewerId: REVIEWER,
      grantId: grant.id,
      expiresAt: shiftNowByDays(-1),
    });
    const tokens = createTokenAuth(harness.handle);
    const minted = await tokens.mintToken({
      userId: REVIEWER,
      name: "revoked",
      scope: AccessLevels.READ,
      tokenHash: "r".repeat(64),
      grantId: grant.id,
      expiresAt: null,
    });
    await tokens.revokeToken(REVIEWER, minted.id, shiftNowByDays(-1));

    await createSweepSessionsTask(makeDeps(harness))();

    expect(await countGrants(harness)).toBe(0);
    expect(readRevokedTokens(fetchFn)).toEqual([ACCESS_TOKEN]);
  });

  it("warns when GitHub refuses a revoke and still deletes the grant", async () => {
    stubTokenDelete(SERVER_ERROR);
    await makeRevokedTokenGrant(harness);
    const capture = captureLogger();

    await createSweepSessionsTask(makeDeps(harness, capture.logger))();

    expect(await countGrants(harness)).toBe(0);
    const warned = capture
      .readLines()
      .filter((line) => line["evt"] === "grant.revoke.fail");
    expect(warned).toHaveLength(1);
    expect(JSON.stringify(warned)).not.toContain(ACCESS_TOKEN);
  });

  it("logs one line with what the sweep deleted", async () => {
    stubTokenDelete(NO_CONTENT);
    await makeRevokedTokenGrant(harness);
    const capture = captureLogger();

    await createSweepSessionsTask(makeDeps(harness, capture.logger))();

    const lines = capture
      .readLines()
      .filter((line) => String(line["msg"]).startsWith("sweep-sessions"));
    expect(lines.map((line) => line["msg"])).toEqual([
      "sweep-sessions: 0 expired sessions and 0 tokens deleted, 1 grants orphaned",
    ]);
  });

  it("revokes what earlier batches removed when a later batch throws", async () => {
    const fetchFn = stubTokenDelete(NO_CONTENT);
    const isolated = await openPerTestPglite();
    await seedSession(isolated, "expired", REVIEWER, shiftNowByDays(-1));
    await makeRevokedTokenGrant(isolated, "old", shiftNowByDays(-31));
    await isolated.raw(
      "create function refuse_token_delete() returns trigger language plpgsql as $$ begin raise exception 'token delete refused'; end $$",
    );
    await isolated.raw(
      "create trigger refuse_token_delete before delete on api_token for each row execute function refuse_token_delete()",
    );

    const sweep = createSweepSessionsTask(makeDeps(isolated))();

    await expect(sweep).rejects.toThrow(/delete from "api_token"/);
    expect(readRevokedTokens(fetchFn)).toEqual([ACCESS_TOKEN, ACCESS_TOKEN]);
  });

  it("skips the revokes its time budget does not reach and warns once", async () => {
    vi.stubGlobal("fetch", vi.fn(stubHangingFetch));
    for (const name of ["a", "b", "c", "d", "e"]) {
      await makeRevokedTokenGrant(harness, name);
    }
    const capture = captureLogger();
    const deps = makeDeps(harness, capture.logger, {
      oauthApp: createOAuthApp({
        clientId: "test-client-id",
        clientSecret: "test-client-secret",
        requestTimeoutMs: 50,
      }),
      revokeBudgetMs: 10,
    });

    await createSweepSessionsTask(deps)();

    const lines = capture.readLines();
    const failed = lines.filter((line) => line["evt"] === "grant.revoke.fail");
    const skipped = lines.filter((line) => line["skipped"] !== undefined);
    expect(failed).toHaveLength(3);
    expect(skipped.map((line) => line["skipped"])).toEqual([2]);
    expect(await countGrants(harness)).toBe(0);
  });
});
