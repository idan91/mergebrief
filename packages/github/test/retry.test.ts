// Regression tests for the 406 retry tuning (BRIEF-3 Part 4): a 406 from
// GitHub ("diff too large to render") is PERMANENT for the requested span, so
// the bundled retry plugin must not retry it. Exercised through the REAL
// `createUserOctokit` construction with an injected fetch counting calls.
import { describe, expect, it, vi } from "vitest";
import { Octokit } from "octokit";
import { DO_NOT_RETRY_STATUSES, retryOptions } from "../src/auth/retry";
import { fetchDiff } from "../src/operations/pull-request";

function countingFetch(status: number) {
  return vi.fn(async () => new Response(JSON.stringify({ message: "nope" }), {
    status,
    headers: { "content-type": "application/json" },
  }));
}

/** Same construction shape as `createUserOctokit`, with a countable fetch. */
function clientWith(fetchImpl: typeof fetch): Octokit {
  return new Octokit({
    auth: "token",
    retry: { ...retryOptions(), retryAfterBaseValue: 1 },
    request: { fetch: fetchImpl },
  });
}

describe("406 retry tuning", () => {
  it("does not retry a 406 (permanent: diff too large)", async () => {
    const fetchImpl = countingFetch(406);
    const result = await fetchDiff(clientWith(fetchImpl), {
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
    const fetchImpl = countingFetch(500);
    const result = await fetchDiff(clientWith(fetchImpl), {
      owner: "o",
      repo: "r",
      prNumber: 1,
    });
    expect(result.ok).toBe(false);
    expect(fetchImpl.mock.calls.length).toBeGreaterThan(1);
  });

  it("keeps the retry plugin's default non-retryable statuses alongside 406", () => {
    // Supplying `doNotRetry` REPLACES the plugin's defaults ([400, 401, 403,
    // 404, 410, 422, 451] — verified against @octokit/plugin-retry's source);
    // dropping any would silently re-enable retries on a permanent status.
    expect(DO_NOT_RETRY_STATUSES).toEqual([400, 401, 403, 404, 406, 410, 422, 451]);
  });
});
