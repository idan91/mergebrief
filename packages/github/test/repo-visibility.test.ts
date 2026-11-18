import { describe, expect, it } from "vitest";
import { bindInstallationGitHub } from "../src/client/installation";
import { GitHubApiErrorCodes } from "../src/errors";
import { RepositoryVisibilities } from "../src/types";
import {
  MINT_OK,
  MINT_PATH,
  MINTED,
  formatTokenAuthorization,
  makeApp,
  requireInstallationId,
  routeMinting,
  stubGitHubFetch,
  type StubResponse,
} from "./client/helpers";

const TRACKER = { owner: "acme", repo: "tracker" };
const TRACKER_PATH = "/repos/acme/tracker";
const LEAKED_TOKEN = "ghs_PLANTED_INSTALLATION_TOKEN";

function stubRepository(answer: StubResponse) {
  return stubGitHubFetch(routeMinting(MINT_OK, answer));
}

function readTrackerVisibility(stub: ReturnType<typeof stubGitHubFetch>) {
  return bindInstallationGitHub(
    makeApp(stub),
    requireInstallationId(99n),
  ).fetchRepositoryVisibility(TRACKER);
}

describe("fetchRepositoryVisibility", () => {
  it.each([
    [RepositoryVisibilities.PRIVATE, true],
    [RepositoryVisibilities.PUBLIC, false],
    [RepositoryVisibilities.INTERNAL, true],
  ])("reads the %s visibility GitHub answers", async (expected, isPrivate) => {
    const stub = stubRepository({
      status: 200,
      body: {
        full_name: "acme/tracker",
        private: isPrivate,
        visibility: expected,
      },
    });

    const result = await readTrackerVisibility(stub);

    expect(result).toEqual({ ok: true, value: expected });
    expect(stub.requests.map((request) => request.path)).toEqual([
      MINT_PATH,
      TRACKER_PATH,
    ]);
    expect(stub.requests[1]?.authorization).toBe(
      formatTokenAuthorization(MINTED),
    );
  });

  it.each([
    [true, RepositoryVisibilities.PRIVATE],
    [false, RepositoryVisibilities.PUBLIC],
  ])(
    "derives the visibility from private %s when GitHub omits it",
    async (isPrivate, expected) => {
      const stub = stubRepository({
        status: 200,
        body: { full_name: "acme/tracker", private: isPrivate },
      });

      const result = await readTrackerVisibility(stub);

      expect(result).toEqual({ ok: true, value: expected });
    },
  );

  it.each([
    [404, GitHubApiErrorCodes.NOT_FOUND],
    [403, GitHubApiErrorCodes.FORBIDDEN],
  ])("answers a %s as the sanitized %s error", async (status, code) => {
    const stub = stubRepository({
      status,
      body: { message: "Not Found", token: LEAKED_TOKEN },
    });

    const result = await readTrackerVisibility(stub);

    expect(result.ok || result.error.code).toBe(code);
    expect(JSON.stringify(result)).not.toContain(LEAKED_TOKEN);
  });

  it.each([
    [{ full_name: "acme/tracker" }],
    [{ full_name: "acme/tracker", private: true, visibility: "secret" }],
  ])("answers an unexpected body as a failed request", async (body) => {
    const stub = stubRepository({ status: 200, body });

    const result = await readTrackerVisibility(stub);

    expect(result).toEqual({
      ok: false,
      error: {
        code: GitHubApiErrorCodes.REQUEST_FAILED,
        message:
          "failed to fetch repository visibility: unexpected GitHub API response shape",
      },
    });
  });
});
