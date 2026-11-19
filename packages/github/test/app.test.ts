// The production App client's installation-token mint: bounded and asked
// once, so an outage cannot leave every later installation call waiting on it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppClient, getInstallationClient } from "../src/auth/app";
import { bindInstallationGitHub } from "../src/client/installation";
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
const SHORT_MINT_TIMEOUT_MS = 100;
/** Room past the mint's budget, still short of the production mint deadline. */
const TEST_SLACK_MS = 2_000;
const REPO_LIST = {
  status: 200,
  body: { total_count: 1, repositories: [{ id: 4242 }] },
};

const MS_PER_SECOND = 1_000;
/** Room for the clock to move between the answer and the throttle plugin reading it. */
const RESET_MARGIN_MS = 200;
/** Two seconds behind the clock, a reset asks the throttle plugin for no wait. */
const PAST_RESET_SECONDS = 2;
const SECONDARY_RETRY_AFTER_SECONDS = 0.05;
/** A real wait of one or two seconds, which octokit's limiters leave no way to fake. */
const THROTTLE_TEST_TIMEOUT_MS = 15_000;
const REPO_PATH = "/repos/acme/widget";
const REPO_OK = { status: 200, body: { id: 4242 } };

/** GitHub's primary limit: a 403 naming the quota as spent and when it resets. */
function makePrimaryLimitAnswer(resetAt: number): StubResponse {
  return {
    status: 403,
    body: { message: "API rate limit exceeded" },
    headers: {
      "x-ratelimit-remaining": "0",
      "x-ratelimit-reset": String(resetAt),
    },
  };
}

/**
 * The plugin waits ceil(reset - now) + 1 whole seconds, so a reset just under
 * a second behind the clock asks for its shortest real wait, one second.
 */
function makeOneSecondLimitAnswer(): StubResponse {
  const behindBySecond = Date.now() - MS_PER_SECOND + RESET_MARGIN_MS;
  return makePrimaryLimitAnswer(Math.ceil(behindBySecond / MS_PER_SECOND));
}

function makeElapsedLimitAnswer(): StubResponse {
  const nowSeconds = Math.floor(Date.now() / MS_PER_SECOND);
  return makePrimaryLimitAnswer(nowSeconds - PAST_RESET_SECONDS);
}

function makeSecondaryLimitAnswer(): StubResponse {
  return {
    status: 403,
    body: { message: "You have exceeded a secondary rate limit" },
    headers: { "retry-after": String(SECONDARY_RETRY_AFTER_SECONDS) },
  };
}

interface RepoReadRoute {
  readonly route: RouteHandler;
  /** When each repository read reached GitHub, in epoch milliseconds. */
  readonly readTimes: number[];
}

/** Mints freely, and answers the repository read with each of `answers` in turn. */
function routeRepoReads(
  answers: readonly (() => StubResponse)[],
): RepoReadRoute {
  const readTimes: number[] = [];
  return {
    readTimes,
    route(request) {
      if (request.path === MINT_PATH) {
        return MINT_OK;
      }
      const answer = answers[Math.min(readTimes.length, answers.length - 1)];
      readTimes.push(Date.now());
      return answer?.();
    },
  };
}

function measureRetryWaitMs(readTimes: readonly number[]): number {
  const [firstRead = 0, retry = 0] = readTimes;
  return retry - firstRead;
}

async function readRepoThroughInstallation(route: RouteHandler) {
  const stub = stubGitHubFetch(route);
  vi.stubGlobal("fetch", stub.fetch);
  const appClient = createAppClient(makeAppConfig());
  const client = await getInstallationClient(appClient, INSTALLATION_ID);
  const read = client.request("GET /repos/{owner}/{repo}", {
    owner: "acme",
    repo: "widget",
  });
  return { read, stub };
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
    { timeout: SHORT_MINT_TIMEOUT_MS + TEST_SLACK_MS },
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
      const appClient = createAppClient(makeAppConfig(), {
        mintTimeoutMs: SHORT_MINT_TIMEOUT_MS,
      });
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
      const repoReads = routeRepoReads([
        makeOneSecondLimitAnswer,
        () => REPO_OK,
      ]);
      const { read, stub } = await readRepoThroughInstallation(repoReads.route);

      const reply = await read;

      expect(reply.status).toBe(200);
      expect(countRepoReads(stub.requests)).toBe(2);
      expect(measureRetryWaitMs(repoReads.readTimes)).toBeGreaterThanOrEqual(
        MS_PER_SECOND,
      );
    },
  );

  it(
    "waits out a secondary limit in place and answers from its retry",
    { timeout: THROTTLE_TEST_TIMEOUT_MS },
    async () => {
      const repoReads = routeRepoReads([
        makeSecondaryLimitAnswer,
        () => REPO_OK,
      ]);
      const { read, stub } = await readRepoThroughInstallation(repoReads.route);

      const reply = await read;

      expect(reply.status).toBe(200);
      expect(countRepoReads(stub.requests)).toBe(2);
      expect(measureRetryWaitMs(repoReads.readTimes)).toBeGreaterThanOrEqual(
        SECONDARY_RETRY_AFTER_SECONDS * MS_PER_SECOND,
      );
    },
  );

  it(
    "fails a request limited again on its one retry",
    { timeout: THROTTLE_TEST_TIMEOUT_MS },
    async () => {
      const { read, stub } = await readRepoThroughInstallation(
        routeRepoReads([makeElapsedLimitAnswer]).route,
      );

      await expect(read).rejects.toMatchObject({ status: 403 });

      expect(countRepoReads(stub.requests)).toBe(2);
    },
  );
});
