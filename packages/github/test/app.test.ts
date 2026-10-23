// The production App client's installation-token mint: bounded and asked
// once, so an outage cannot leave every later installation call waiting on it.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppClient, MINT_TIMEOUT_MS } from "../src/auth/app";
import { bindInstallationGitHub } from "../src/client/installation";
import { CONFIRMATION_READ_TIMEOUT_MS } from "../src/operations/deadline";
import {
  MINT_OK,
  MINT_PATH,
  makeAppConfig,
  requireInstallationId,
  stubGitHubFetch,
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
