import { describe, expect, it, vi } from "vitest";
import { bindInstallationGitHub } from "../../src/client/installation";
import { CONFIRMATION_READ_TIMEOUT_MS } from "../../src/operations/deadline";
import { GitHubApiErrorCodes } from "../../src/errors";
import {
  collaboratorsResponse,
  gqlCollaborator,
} from "../fixtures/collaborators-graphql";
import {
  MINT_OK,
  MINT_PATH,
  MINTED,
  REPO,
  formatTokenAuthorization,
  makeApp,
  makePullRequestBody,
  requireInstallationId,
  requireRepoId,
  routeMinting,
  stubGitHubFetch,
} from "./helpers";

const INSTALLATION_ID = requireInstallationId(99n);
/** Room past the read's own budget before the test itself gives up. */
const TEST_SLACK_MS = 2_000;

describe("bindInstallationGitHub", () => {
  it("mints an installation token and lists collaborators with it", async () => {
    const stub = stubGitHubFetch(
      routeMinting(MINT_OK, {
        status: 200,
        body: {
          data: collaboratorsResponse({
            nodes: [gqlCollaborator({ login: "bob", name: "Bob Example" })],
          }),
        },
      }),
    );
    const github = bindInstallationGitHub(makeApp(stub), INSTALLATION_ID);

    const result = await github.forRepo(REPO).listRepoCollaborators();

    expect(result).toEqual({
      ok: true,
      value: {
        collaborators: [
          {
            login: "bob",
            name: "Bob Example",
            avatarUrl: "https://avatars.example/bob.png",
          },
        ],
        hasMore: false,
      },
    });
    expect(stub.requests.map((request) => request.path)).toEqual([
      MINT_PATH,
      "/graphql",
    ]);
    expect(stub.requests[1]?.authorization).toBe(
      formatTokenAuthorization(MINTED),
    );
  });

  it("answers a refused mint as the call's own failure", async () => {
    const stub = stubGitHubFetch(
      routeMinting(
        { status: 404, body: { message: "Not Found" } },
        { status: 200, body: makePullRequestBody(7) },
      ),
    );
    const github = bindInstallationGitHub(makeApp(stub), INSTALLATION_ID);

    const result = await github.forRepo(REPO).fetchPullRequest(7);

    expect(result.ok || result.error.code).toBe(GitHubApiErrorCodes.NOT_FOUND);
    expect(stub.requests.map((request) => request.path)).toEqual([MINT_PATH]);
  });

  it("answers request-failed when the installation client rejects", async () => {
    const stub = stubGitHubFetch(routeMinting(MINT_OK, MINT_OK));
    const app = makeApp(stub);
    vi.spyOn(app, "getInstallationOctokit").mockRejectedValue(
      new Error(`mint failed for ${MINTED}`),
    );
    const github = bindInstallationGitHub(app, INSTALLATION_ID);

    const result = await github.fetchRepositoryById(requireRepoId(4242n));

    expect(result).toEqual({
      ok: false,
      error: {
        code: GitHubApiErrorCodes.REQUEST_FAILED,
        message: "failed to fetch repository: installation client unavailable",
      },
    });
    expect(stub.requests).toHaveLength(0);
  });

  it("lists every repo id the installation holds, past one page", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      id: index + 1,
    }));
    let listings = 0;
    const stub = stubGitHubFetch((request) => {
      if (request.path === MINT_PATH) {
        return MINT_OK;
      }
      listings += 1;
      if (listings === 1) {
        return {
          status: 200,
          body: { total_count: 101, repositories: firstPage },
          headers: {
            link: '<https://api.github.com/installation/repositories?per_page=100&page=2>; rel="next"',
          },
        };
      }
      return {
        status: 200,
        body: { total_count: 101, repositories: [{ id: 4242 }] },
      };
    });
    const github = bindInstallationGitHub(makeApp(stub), INSTALLATION_ID);

    const lastPageRepo = requireRepoId(4242n);

    const result = await github.listInstallationRepoIds();

    expect(result.ok && result.value.size).toBe(101);
    expect(result.ok && result.value.has(lastPageRepo)).toBe(true);
    expect(stub.requests.map((request) => request.path)).toEqual([
      MINT_PATH,
      "/installation/repositories",
      "/installation/repositories",
    ]);
    expect(stub.requests[1]?.authorization).toBe(
      formatTokenAuthorization(MINTED),
    );
  });

  it("answers request-failed when the repo list cannot mint", async () => {
    const stub = stubGitHubFetch(routeMinting(MINT_OK, MINT_OK));
    const app = makeApp(stub);
    vi.spyOn(app, "getInstallationOctokit").mockRejectedValue(
      new Error("installation suspended"),
    );
    const github = bindInstallationGitHub(app, INSTALLATION_ID);

    const result = await github.listInstallationRepoIds();

    expect(result).toEqual({
      ok: false,
      error: {
        code: GitHubApiErrorCodes.REQUEST_FAILED,
        message:
          "failed to list installation repo ids: installation client unavailable",
      },
    });
  });

  it("asks GitHub once when the repo list answers a 5xx", async () => {
    const stub = stubGitHubFetch(
      routeMinting(MINT_OK, { status: 502, body: { message: "down" } }),
    );
    const github = bindInstallationGitHub(makeApp(stub), INSTALLATION_ID);

    const result = await github.listInstallationRepoIds();

    expect(result.ok || result.error.code).toBe(
      GitHubApiErrorCodes.REQUEST_FAILED,
    );
    expect(stub.requests.map((request) => request.path)).toEqual([
      MINT_PATH,
      "/installation/repositories",
    ]);
  });

  it(
    "answers request-failed when the repo list does not answer in time",
    { timeout: CONFIRMATION_READ_TIMEOUT_MS + TEST_SLACK_MS },
    async () => {
      const stub = stubGitHubFetch((request) =>
        request.path === MINT_PATH ? MINT_OK : undefined,
      );
      const github = bindInstallationGitHub(makeApp(stub), INSTALLATION_ID);

      const result = await github.listInstallationRepoIds();

      expect(result.ok || result.error.code).toBe(
        GitHubApiErrorCodes.REQUEST_FAILED,
      );
    },
  );

  it("answers not-found when the repo list's mint is refused", async () => {
    const stub = stubGitHubFetch(
      routeMinting({ status: 404, body: { message: "Not Found" } }, MINT_OK),
    );
    const github = bindInstallationGitHub(makeApp(stub), INSTALLATION_ID);

    const result = await github.listInstallationRepoIds();

    expect(result).toMatchObject({
      ok: false,
      error: { code: GitHubApiErrorCodes.NOT_FOUND, status: 404 },
    });
  });
});
