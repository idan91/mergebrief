import { describe, expect, it, vi } from "vitest";
import { bindInstallationGitHub } from "../../src/client/installation";
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
});
