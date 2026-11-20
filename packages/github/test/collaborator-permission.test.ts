import { describe, expect, it } from "vitest";
import { bindInstallationGitHub } from "../src/client/installation";
import { GitHubApiErrorCodes } from "../src/errors";
import { CollaboratorPermissions } from "../src/operations/collaborator-permission/types";
import type { ConfirmationReadOptions } from "../src/operations/deadline";
import {
  MINT_OK,
  MINT_PATH,
  MINTED,
  REPO,
  formatTokenAuthorization,
  makeApp,
  requireInstallationId,
  routeMinting,
  stubGitHubFetch,
  type StubResponse,
} from "./client/helpers";

const INSTALLATION_ID = requireInstallationId(99n);
const PERMISSION_PATH = "/repos/acme/widgets/collaborators/bob/permission";
const SHORT_DEADLINE_MS = 50;
/** Room past the read's own budget, still short of the production deadline. */
const TEST_SLACK_MS = 2_000;

function stubPermission(answer: StubResponse) {
  return stubGitHubFetch(routeMinting(MINT_OK, answer));
}

function readBobPermission(
  stub: ReturnType<typeof stubGitHubFetch>,
  confirmationReads: ConfirmationReadOptions = {},
) {
  return bindInstallationGitHub(
    makeApp(stub),
    INSTALLATION_ID,
    confirmationReads,
  )
    .forRepo(REPO)
    .readCollaboratorPermission("bob");
}

describe("readCollaboratorPermission", () => {
  it.each([
    ["admin", CollaboratorPermissions.ADMIN],
    ["write", CollaboratorPermissions.WRITE],
    ["read", CollaboratorPermissions.READ],
    ["none", CollaboratorPermissions.NONE],
  ])("reads GitHub's %s permission", async (permission, expected) => {
    const stub = stubPermission({
      status: 200,
      body: { permission, role_name: permission, user: { login: "bob" } },
    });

    const result = await readBobPermission(stub);

    expect(result).toEqual({ ok: true, value: expected });
    expect(stub.requests.map((request) => request.path)).toEqual([
      MINT_PATH,
      PERMISSION_PATH,
    ]);
    expect(stub.requests[1]?.authorization).toBe(
      formatTokenAuthorization(MINTED),
    );
  });

  it("answers a failure on a permission it does not know", async () => {
    const stub = stubPermission({
      status: 200,
      body: { permission: "owner", user: { login: "bob" } },
    });

    const result = await readBobPermission(stub);

    expect(result).toEqual({
      ok: false,
      error: {
        code: GitHubApiErrorCodes.REQUEST_FAILED,
        message:
          "failed to read collaborator permission: unexpected GitHub API response shape",
      },
    });
  });

  it("asks GitHub once when the permission read answers a 5xx", async () => {
    const stub = stubPermission({ status: 502, body: { message: "down" } });

    const result = await readBobPermission(stub);

    expect(result.ok || result.error.code).toBe(
      GitHubApiErrorCodes.REQUEST_FAILED,
    );
    expect(stub.requests.map((request) => request.path)).toEqual([
      MINT_PATH,
      PERMISSION_PATH,
    ]);
  });

  it(
    "answers request-failed when the permission read misses its deadline",
    { timeout: SHORT_DEADLINE_MS + TEST_SLACK_MS },
    async () => {
      const stub = stubGitHubFetch((request) =>
        request.path === MINT_PATH ? MINT_OK : undefined,
      );

      const result = await readBobPermission(stub, {
        deadlineMs: SHORT_DEADLINE_MS,
      });

      expect(result.ok || result.error.code).toBe(
        GitHubApiErrorCodes.REQUEST_FAILED,
      );
    },
  );
});
