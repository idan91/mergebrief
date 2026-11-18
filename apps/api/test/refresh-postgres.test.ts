// A refresh holds its pool client inside the grant's transaction while
// GitHub answers. PGlite has no backend for Postgres to end, so this suite
// runs only against MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset,
// red under CI.
import { FakeFailures, makeFakeGitHub } from "github/testing";
import {
  closeDb,
  createDb,
  createSessionAuth,
  ensureAppSchema,
  type AppDatabase,
} from "persistence";
import {
  buildNamedPostgresUrl,
  readTestPostgresUrl,
  terminateIdleTransactions,
  waitUntil,
} from "persistence/testing";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../src/index";
import { SECRET, createKeyProvider, getRequestUrl } from "./fixtures";
import { testLogger } from "./logging";
import { UNUSED_INSTALLATION_DEPS, buildFakeAuthDeps } from "./reviewer-github";
import { seedSignIn } from "./sign-in";

const databaseUrl = readTestPostgresUrl(process.env);
const HELD_REFRESH_APPLICATION = "api-held-refresh";
const POOL_SIZE = 2;
const OAUTH_BOUND_MS = 1_000;
const CLIENT_END_WAIT_MS = 5_000;

/** GitHub's token endpoint never answers; `onReached` fires once it is hit. */
function stubHungTokenRefresh(onReached: () => void): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: string | URL | Request, init?: RequestInit) => {
      const url = getRequestUrl(input);
      if (!url.includes("/login/oauth/access_token")) {
        return Promise.reject(new Error(`unexpected fetch: ${url}`));
      }
      onReached();
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(init.signal?.reason);
        });
      });
    }),
  );
}

describe.skipIf(databaseUrl === undefined)("refresh on real Postgres", () => {
  const opened: AppDatabase[] = [];

  beforeAll(async () => {
    if (databaseUrl === undefined) {
      throw new Error("unreachable");
    }
    const ensured = await ensureAppSchema(databaseUrl, { autoMigrate: true });
    if (!ensured.ok) {
      throw new Error(ensured.error.message);
    }
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    for (const handle of opened.splice(0)) {
      await closeDb(handle);
    }
  });

  it("answers 500 and keeps the session when Postgres ends a held refresh", async () => {
    if (databaseUrl === undefined) {
      throw new Error("unreachable");
    }
    const uncaught: unknown[] = [];
    function recordUncaught(error: unknown): void {
      uncaught.push(error);
    }
    process.on("uncaughtException", recordUncaught);
    const forwarded: Error[] = [];
    const handle = createDb(
      buildNamedPostgresUrl(databaseUrl, HELD_REFRESH_APPLICATION),
      { maxConnections: POOL_SIZE, onError: (error) => forwarded.push(error) },
    );
    const observer = createDb(databaseUrl);
    opened.push(handle, observer);
    const kp = createKeyProvider();
    const fake = makeFakeGitHub();
    fake.failOn("listUserInstallations", FakeFailures.UNAUTHORIZED);
    let refreshReached = false;
    stubHungTokenRefresh(() => {
      refreshReached = true;
    });
    const signIn = await seedSignIn(handle, kp);
    const app = createApp({
      logger: testLogger(),
      handle,
      webhookSecret: SECRET,
      auth: {
        ...buildFakeAuthDeps(kp, fake),
        oauthRequestTimeoutMs: OAUTH_BOUND_MS,
      },
      ...UNUSED_INSTALLATION_DEPS,
    });

    const pending = app.request("/api/inbox", {
      headers: { Cookie: `__Host-mergebrief_session=${signIn.cookie}` },
    });
    await waitUntil(() => refreshReached, CLIENT_END_WAIT_MS);
    const ended = await terminateIdleTransactions(
      observer,
      HELD_REFRESH_APPLICATION,
    );
    await waitUntil(
      () => forwarded.length + uncaught.length > 0,
      CLIENT_END_WAIT_MS,
    );
    const res = await pending;
    process.off("uncaughtException", recordUncaught);

    expect(ended).toBe(1);
    expect(uncaught).toEqual([]);
    expect(res.status).toBe(500);
    const kept = await createSessionAuth(handle).findSession(signIn.cookieHash);
    expect(kept?.grant.id).toBe(signIn.grantId);
    await createSessionAuth(handle).deleteSession(signIn.cookieHash);
  });
});
