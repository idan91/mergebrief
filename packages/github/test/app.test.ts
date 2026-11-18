// The production App client's installation-token mint: bounded and asked
// once, so an outage cannot leave every later installation call waiting on it.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createAppClient,
  getInstallationClient,
  MINT_TIMEOUT_MS,
} from "../src/auth/app";
import { bindInstallationGitHub } from "../src/client/installation";
import { CONFIRMATION_READ_TIMEOUT_MS } from "../src/operations/deadline";
import {
  MINT_OK,
  MINT_PATH,
  makeAppConfig,
  requireInstallationId,
  stubGitHubFetch,
  type RouteHandler,
  type StubResponse,
} from "./client/helpers";

const INSTALLATION_ID = requireInstallationId(99n);
/** Room past both budgets before the test itself gives up. */
const TEST_SLACK_MS = 2_000;
/** Past the retry plugin's first backoff, so a late retry would have landed. */
const RETRY_WINDOW_MS = 1_500;
const REPO_LIST = {
  status: 200,
  body: { total_count: 1, repositories: [{ id: 4242 }] },
};

const MS_PER_SECOND = 1_000;
const RATE_LIMIT_WAIT_SECONDS = 1;
/** Two real waits of about two seconds each, which octokit's limiters leave no way to fake. */
const THROTTLE_TEST_TIMEOUT_MS = 15_000;
const REPO_PATH = "/repos/acme/widget";
const REPO_OK = { status: 200, body: { id: 4242 } };

/** GitHub's primary limit: a 403 naming the quota as spent and when it resets. */
function makePrimaryLimitAnswer(): StubResponse {
  const resetAt =
    Math.floor(Date.now() / MS_PER_SECOND) + RATE_LIMIT_WAIT_SECONDS;
  return {
    status: 403,
    body: { message: "API rate limit exceeded" },
    headers: {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(resetAt),
    },
  };
}

function makeSecondaryLimitAnswer(): StubResponse {
  return {
    status: 403,
    body: { message: "You have exceeded a secondary rate limit" },
    headers: { "retry-after": String(RATE_LIMIT_WAIT_SECONDS) },
  };
}

/** Mints freely, and answers the repository read with each of `answers` in turn. */
function routeRepoReads(
  answers: readonly (() => StubResponse)[],
): RouteHandler {
  let reads = 0;
  return (request) => {
    if (request.path === MINT_PATH) {
      return MINT_OK;
    }
    const answer = answers[Math.min(reads, answers.length - 1)];
    reads += 1;
    return answer?.();
  };
}

async function readRepoThroughInstallation(route: RouteHandler) {
  const stub = stubGitHubFetch(route);
  vi.stubGlobal("fetch", stub.fetch);
  const appClient = createAppClient(makeAppConfig());
  const client = await getInstallationClient(appClient, INSTALLATION_ID);
  const startedAt = Date.now();
  const read = client.request("GET /repos/{owner}/{repo}", {
    owner: "acme",
    repo: "widget",
  });
  return { read, startedAt, stub };
}

function countRepoReads(paths: readonly { path: string }[]): number {
  return paths.filter((request) => request.path === REPO_PATH).length;
}

function countMints(paths: readonly string[]): number {
  return paths.filter((path) => path === MINT_PATH).length;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createAppClient installation mint", () => {
  it(
    "mints fresh after a mint that hung past its deadline",
    { timeout: MINT_TIMEOUT_MS + CONFIRMATION_READ_TIMEOUT_MS + TEST_SLACK_MS },
    async () => {
      let mints = 0;
      const stub = stubGitHubFetch((request) => {
        if (request.path !== MINT_PATH) {
          return REPO_LIST;
        }
        mints += 1;
        return mints === 1 ? undefined : MINT_OK;
      });
      vi.stubGlobal("fetch", stub.fetch);
      const appClient = createAppClient(makeAppConfig());
      const github = bindInstallationGitHub(appClient, INSTALLATION_ID);

      const stuck = await github.listInstallationRepoIds();
      const recovered = await github.listInstallationRepoIds();

      expect(stuck.ok).toBe(false);
      expect(recovered).toEqual({ ok: true, value: new Set([4242n]) });
      expect(mints).toBe(2);
    },
  );

  it("asks for a token once when the mint answers a 5xx", async () => {
    const stub = stubGitHubFetch((request) => {
      if (request.path === MINT_PATH) {
        return { status: 502, body: { message: "Bad Gateway" } };
      }
      return REPO_LIST;
    });
    vi.stubGlobal("fetch", stub.fetch);
    const appClient = createAppClient(makeAppConfig());
    const github = bindInstallationGitHub(appClient, INSTALLATION_ID);

    const result = await github.listInstallationRepoIds();
    await new Promise((resolve) => setTimeout(resolve, RETRY_WINDOW_MS));

    const paths = stub.requests.map((request) => request.path);
    expect(result.ok).toBe(false);
    expect(countMints(paths)).toBe(1);
  });
});

describe("createAppClient installation throttle", () => {
  it(
    "waits out a primary limit in place and answers from its retry",
    { timeout: THROTTLE_TEST_TIMEOUT_MS },
    async () => {
      const { read, startedAt, stub } = await readRepoThroughInstallation(
        routeRepoReads([makePrimaryLimitAnswer, () => REPO_OK]),
      );

      const reply = await read;

      expect(reply.status).toBe(200);
      expect(countRepoReads(stub.requests)).toBe(2);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(MS_PER_SECOND);
    },
  );

  it(
    "waits out a secondary limit in place and answers from its retry",
    { timeout: THROTTLE_TEST_TIMEOUT_MS },
    async () => {
      const { read, startedAt, stub } = await readRepoThroughInstallation(
        routeRepoReads([makeSecondaryLimitAnswer, () => REPO_OK]),
      );

      const reply = await read;

      expect(reply.status).toBe(200);
      expect(countRepoReads(stub.requests)).toBe(2);
      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(MS_PER_SECOND);
    },
  );

  it(
    "fails a request limited again on its one retry",
    { timeout: THROTTLE_TEST_TIMEOUT_MS },
    async () => {
      const { read, stub } = await readRepoThroughInstallation(
        routeRepoReads([makePrimaryLimitAnswer]),
      );

      await expect(read).rejects.toMatchObject({ status: 403 });

      expect(countRepoReads(stub.requests)).toBe(2);
    },
  );
});
