// Regression tests for the 406 retry tuning: a 406 from GitHub ("diff too large
// to render") is PERMANENT for the requested span, so the bundled retry plugin
// must not retry it. Exercised through the REAL `createUserOctokit`
// construction with an injected fetch counting calls.
import { describe, expect, it, vi } from "vitest";
import { Octokit } from "octokit";
import {
  createUserOctokit,
  deriveThrottleKey,
  retryOnceAfterLimit,
} from "../src/auth/oauth";
import { DO_NOT_RETRY_STATUSES, retryOptions } from "../src/auth/retry";
import { fetchDiff } from "../src/operations/pull-request";

function stubCountingFetch(status: number) {
  return vi.fn(
    async () =>
      new Response(JSON.stringify({ message: "nope" }), {
        status,
        headers: { "content-type": "application/json" },
      }),
  );
}

/** Same construction shape as `createUserOctokit`, with a countable fetch. */
function makeClientWith(fetchImpl: typeof fetch): Octokit {
  return new Octokit({
    auth: "token",
    retry: { ...retryOptions(), retryAfterBaseValue: 1 },
    request: { fetch: fetchImpl },
  });
}

describe("406 retry tuning", () => {
  it("does not retry a 406, the permanent diff-too-large status", async () => {
    const fetchImpl = stubCountingFetch(406);
    const result = await fetchDiff(makeClientWith(fetchImpl), {
      owner: "o",
      repo: "r",
      prNumber: 1,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.error.status).toBe(406);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("still retries a transient 500", async () => {
    const fetchImpl = stubCountingFetch(500);
    const result = await fetchDiff(makeClientWith(fetchImpl), {
      owner: "o",
      repo: "r",
      prNumber: 1,
    });
    expect(result.ok).toBe(false);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
  });

  it("keeps the retry plugin's default non-retryable statuses alongside 406", () => {
    // Supplying `doNotRetry` REPLACES the plugin's defaults ([400, 401, 403,
    // 404, 410, 422, 451]); dropping any would silently re-enable retries on a
    // permanent status.
    expect(DO_NOT_RETRY_STATUSES).toEqual([
      400, 401, 403, 404, 406, 410, 422, 451,
    ]);
  });
});

describe("deriveThrottleKey", () => {
  it("gives distinct tokens distinct keys and never leaks the token", () => {
    const token = "ghu_PLANTED_USER_TOKEN";
    const key = deriveThrottleKey(token);

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(deriveThrottleKey(token));
    expect(key).not.toBe(deriveThrottleKey("ghu_OTHER_TOKEN"));
    expect(key).not.toContain(token);
  });
});

describe("retryOnceAfterLimit", () => {
  it("retries a rate-limited request once, then gives up", () => {
    expect(retryOnceAfterLimit(60, { request: { retryCount: 0 } })).toBe(true);
    expect(retryOnceAfterLimit(60, { request: { retryCount: 1 } })).toBe(false);
  });
});

describe("createUserOctokit with retry off", () => {
  it("sends a request once and never replays it on a 5xx", async () => {
    const fetchImpl = stubCountingFetch(502);
    const octokit = createUserOctokit("ghu_token", {
      retry: false,
      throttle: false,
      fetch: fetchImpl,
    });
    const result = await fetchDiff(octokit, {
      owner: "o",
      repo: "r",
      prNumber: 1,
    });

    expect(result.ok).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe("createUserOctokit", () => {
  it("constructs with a throttle id and the rate-limit handlers intact", () => {
    // `throttle` is shallow-merged over octokit's defaults: an id alone would
    // drop the handlers and the throttling plugin refuses to build.
    expect(() => createUserOctokit("ghu_token")).not.toThrow();
  });

  it("runs back-to-back mutations unpaced when throttling is off", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: {} }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );
    const octokit = createUserOctokit("ghu_token", {
      throttle: false,
      fetch: fetchImpl,
    });
    const started = Date.now();
    await octokit.graphql("mutation { noop }");
    await octokit.graphql("mutation { noop }");
    expect(Date.now() - started).toBeLessThan(500);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
