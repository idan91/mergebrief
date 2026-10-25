// The sign-in return-to: the start stores a validated path beside the state
// cookie, and a successful callback lands there instead of Home.
import { randomBytes } from "node:crypto";
import { SIGN_IN_RETURN_PARAM } from "contract";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, type ApiApp } from "../src/index";
import { testLogger } from "./logging";
import { SECRET, buildAuthDeps, createKeyProvider } from "./fixtures";
import {
  UNUSED_INSTALLATION_DEPS,
  makeTokenSuccess,
  stubGitHub,
} from "./reviewer-github";
import { ACCESS_TOKEN, REFRESH_TOKEN } from "./sign-in";
import { registerSharedPglite } from "./shared-pglite";

const RETURN_COOKIE = "__Host-mergebrief_oauth_return";
const STATE_COOKIE = "__Host-mergebrief_oauth_state";
const OAUTH_STATE_BYTES = 32;
const PR_PATH = "/repos/424242/pulls/1?rev=1&thread=9";
const STORED_PR_PATH = encodeURIComponent(PR_PATH);
const STATE = "matching-state-nonce";

function findSetCookie(res: Response, name: string): string | undefined {
  return res.headers
    .getSetCookie()
    .find((cookie) => cookie.startsWith(`${name}=`));
}

function readCookieValue(setCookie: string | undefined): string | undefined {
  const pair = setCookie?.split(";")[0];
  if (pair === undefined) {
    return undefined;
  }
  const valueStart = pair.indexOf("=") + 1;
  return decodeURIComponent(pair.slice(valueStart));
}

function buildStartUrl(returnTo: string): string {
  const search = new URLSearchParams({ [SIGN_IN_RETURN_PARAM]: returnTo });
  return `/api/auth/github?${search.toString()}`;
}

function buildCookieHeader(returnCookie: string): string {
  return `${STATE_COOKIE}=${STATE}; ${RETURN_COOKIE}=${returnCookie}`;
}

describe("sign-in return-to", () => {
  const harness = registerSharedPglite();
  let app: ApiApp;

  beforeEach(() => {
    app = createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildAuthDeps(createKeyProvider()),
      ...UNUSED_INSTALLATION_DEPS,
    });
  });

  it("a start with a safe returnTo stores it in a host cookie", async () => {
    const res = await app.request(buildStartUrl(PR_PATH));

    expect(res.status).toBe(302);
    const returnCookie = findSetCookie(res, RETURN_COOKIE);
    expect(readCookieValue(returnCookie)).toBe(PR_PATH);
    expect(returnCookie).toContain("Max-Age=600");
    expect(returnCookie).toContain("HttpOnly");
    expect(returnCookie).toContain("Secure");
    expect(returnCookie).toContain("SameSite=Lax");
    expect(returnCookie).toContain("Path=/");
    expect(returnCookie).not.toContain("Domain=");
  });

  it("a start reusing an in-flight state still stores the returnTo", async () => {
    const inFlight = randomBytes(OAUTH_STATE_BYTES).toString("base64url");

    const res = await app.request(buildStartUrl(PR_PATH), {
      headers: { Cookie: `${STATE_COOKIE}=${inFlight}` },
    });

    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("state")).toBe(inFlight);
    const returnCookie = findSetCookie(res, RETURN_COOKIE);
    expect(readCookieValue(returnCookie)).toBe(PR_PATH);
    expect(returnCookie).toContain("Max-Age=600");
  });

  it.each(["//evil.example", "/api/auth/github", "https://evil.example"])(
    "a start with unsafe returnTo %j clears the stored one",
    async (returnTo) => {
      const res = await app.request(buildStartUrl(returnTo), {
        headers: { Cookie: `${RETURN_COOKIE}=%2Fsettings` },
      });

      expect(res.status).toBe(302);
      const returnCookie = findSetCookie(res, RETURN_COOKIE);
      expect(readCookieValue(returnCookie)).toBe("");
      expect(returnCookie).toMatch(/Max-Age=0/i);
    },
  );

  it("a start without returnTo clears the stored one", async () => {
    const res = await app.request("/api/auth/github", {
      headers: { Cookie: `${RETURN_COOKIE}=%2Fsettings` },
    });

    const returnCookie = findSetCookie(res, RETURN_COOKIE);
    expect(readCookieValue(returnCookie)).toBe("");
    expect(returnCookie).toMatch(/Max-Age=0/i);
  });

  it("a start without returnTo or a stored one sets no return cookie", async () => {
    const res = await app.request("/api/auth/github");

    expect(findSetCookie(res, STATE_COOKIE)).toBeDefined();
    expect(findSetCookie(res, RETURN_COOKIE)).toBeUndefined();
  });

  it("a signed-in callback lands on the stored path and clears it", async () => {
    stubGitHub({ token: makeTokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN) });

    const res = await app.request(
      `/api/auth/github/callback?code=thecode&state=${STATE}`,
      { headers: { Cookie: buildCookieHeader(STORED_PR_PATH) } },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(PR_PATH);
    expect(findSetCookie(res, RETURN_COOKIE)).toMatch(/Max-Age=0/i);
    expect(findSetCookie(res, "__Host-mergebrief_session")).toBeDefined();
  });

  it.each(["%2F%2Fevil.example", "https%3A%2F%2Fevil.example", "%2Fapi"])(
    "a signed-in callback with tampered cookie %j lands home",
    async (tampered) => {
      stubGitHub({ token: makeTokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN) });

      const res = await app.request(
        `/api/auth/github/callback?code=thecode&state=${STATE}`,
        { headers: { Cookie: buildCookieHeader(tampered) } },
      );

      expect(res.status).toBe(302);
      expect(res.headers.get("location")).toBe("/");
      expect(findSetCookie(res, RETURN_COOKIE)).toMatch(/Max-Age=0/i);
    },
  );

  it("a failed sign-in lands home with the error and clears the path", async () => {
    stubGitHub({
      token: makeTokenSuccess(ACCESS_TOKEN, REFRESH_TOKEN),
      userStatus: 401,
    });

    const res = await app.request(
      `/api/auth/github/callback?code=thecode&state=${STATE}`,
      { headers: { Cookie: buildCookieHeader(STORED_PR_PATH) } },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?error=github-unavailable");
    expect(findSetCookie(res, RETURN_COOKIE)).toMatch(/Max-Age=0/i);
  });

  it("a cancelled sign-in lands home and keeps the stored path", async () => {
    const res = await app.request(
      `/api/auth/github/callback?error=access_denied&state=${STATE}`,
      { headers: { Cookie: buildCookieHeader(STORED_PR_PATH) } },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/");
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("a mismatched state lands on sign-in-failed and keeps the path", async () => {
    const res = await app.request(
      "/api/auth/github/callback?code=thecode&state=another-state",
      { headers: { Cookie: buildCookieHeader(STORED_PR_PATH) } },
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/?error=sign-in-failed");
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});
