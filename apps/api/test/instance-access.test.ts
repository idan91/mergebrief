// Who may start a paid run: the paste route over PGlite and the
// `github/testing` fake, under each shape of the instance's `allowed` block.
import type { UserInstallation } from "github";
import { FakeFailures, makeFakeGitHub, type FakeGitHub } from "github/testing";
import type { KeyProvider } from "persistence";
import type { Mutable } from "types/utils";
import { beforeEach, describe, expect, it } from "vitest";
import { createApp, type ApiApp, type AppDeps } from "../src/index";
import { testLogger } from "./logging";
import {
  brandInstallationId,
  brandReviewerId,
  createKeyProvider,
  SAME_ORIGIN_HEADERS,
  SECRET,
} from "./fixtures";
import {
  UNUSED_INSTALLATION_DEPS,
  buildFakeAuthDeps,
  makeFakePullRequestInfo,
  stubRefusedTokenRefresh,
} from "./reviewer-github";
import { seedSignIn } from "./sign-in";
import { registerSharedPglite } from "./shared-pglite";

const PR_URL = "https://github.com/o/r/pull/7";
const PR_REF = { owner: "o", repo: "r", prNumber: 7 };
const REPO_ID = 424242;
const VIEWER_ID = 555n;
const LISTED_ACCOUNT = 9919n;
const OTHER_ACCOUNT = 7070n;

/** An installation of the App the viewer reaches, holding no repository. */
function arrangeInstallation(
  fake: FakeGitHub,
  accountId?: bigint,
  suspended?: true,
): void {
  const installation: Mutable<UserInstallation> = {
    installationId: brandInstallationId(31n),
    accountLogin: "acme",
  };
  if (accountId !== undefined) {
    installation.accountId = accountId;
  }
  if (suspended !== undefined) {
    installation.suspended = suspended;
  }
  fake.addInstallation(installation, new Map());
}

function arrangePastedPull(fake: FakeGitHub): void {
  fake.addPullRequest(PR_REF, {
    info: {
      ...makeFakePullRequestInfo({ repoId: REPO_ID }),
      repoFullName: "o/r",
      htmlUrl: PR_URL,
    },
  });
}

describe("who may start a paid run from a paste", () => {
  const harness = registerSharedPglite();
  let kp: KeyProvider;
  let fake: FakeGitHub;

  beforeEach(() => {
    kp = createKeyProvider();
    fake = makeFakeGitHub();
    arrangePastedPull(fake);
  });

  function buildApp(
    policy: Pick<AppDeps, "allowedAccess" | "operatorIds"> = {},
  ): ApiApp {
    return createApp({
      logger: testLogger(),
      handle: harness.handle,
      webhookSecret: SECRET,
      auth: buildFakeAuthDeps(kp, fake),
      ...UNUSED_INSTALLATION_DEPS,
      ...policy,
    });
  }

  async function paste(app: ApiApp): Promise<Response> {
    const { cookie } = await seedSignIn(harness.handle, kp, {
      reviewer: { id: brandReviewerId(VIEWER_ID), login: "octocat" },
    });
    return app.request("/api/generate", {
      method: "POST",
      body: JSON.stringify({ url: PR_URL }),
      headers: {
        ...SAME_ORIGIN_HEADERS,
        "content-type": "application/json",
        Cookie: `__Host-mergebrief_session=${cookie}`,
      },
    });
  }

  async function countGenerateJobs(): Promise<number> {
    const rows = await harness.raw(
      "select id from graphile_worker.jobs where task_identifier = 'generate'",
    );
    return rows.length;
  }

  async function readCode(res: Response): Promise<unknown> {
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null) {
      return undefined;
    }
    return "code" in body ? body.code : undefined;
  }

  describe("with nothing configured", () => {
    it("refuses a viewer in an installation, before any read or job", async () => {
      arrangeInstallation(fake, LISTED_ACCOUNT);

      const res = await paste(buildApp());

      expect(res.status).toBe(403);
      expect(await readCode(res)).toBe("account-not-allowed");
      expect(fake.listCalls("fetchPullRequest")).toEqual([]);
      expect(await countGenerateJobs()).toBe(0);
    });
  });

  describe("with Operators", () => {
    it("lets an Operator in no installation paste, with no installation read", async () => {
      const res = await paste(buildApp({ operatorIds: new Set([VIEWER_ID]) }));

      expect(res.status).toBe(202);
      expect(fake.listCalls("listUserInstallations")).toEqual([]);
    });

    it("counts an installation on an Operator's personal account", async () => {
      arrangeInstallation(fake, LISTED_ACCOUNT);

      const res = await paste(
        buildApp({ operatorIds: new Set([LISTED_ACCOUNT]) }),
      );

      expect(res.status).toBe(202);
    });
  });

  describe("with an allowed block", () => {
    it("lets a listed user paste, with no installation read", async () => {
      const allowedAccess = {
        users: new Set([VIEWER_ID]),
        accounts: new Set<bigint>(),
      };

      const res = await paste(buildApp({ allowedAccess }));

      expect(res.status).toBe(202);
      expect(fake.listCalls("listUserInstallations")).toEqual([]);
    });

    it("lets a viewer in a listed account's installation paste", async () => {
      arrangeInstallation(fake, LISTED_ACCOUNT);
      const allowedAccess = {
        users: new Set<bigint>(),
        accounts: new Set([LISTED_ACCOUNT]),
      };

      const res = await paste(buildApp({ allowedAccess }));

      expect(res.status).toBe(202);
    });

    it("refuses a viewer whose installation is another account's", async () => {
      arrangeInstallation(fake, OTHER_ACCOUNT);
      const allowedAccess = {
        users: new Set<bigint>(),
        accounts: new Set([LISTED_ACCOUNT]),
      };

      const res = await paste(buildApp({ allowedAccess }));

      expect(res.status).toBe(403);
      expect(await countGenerateJobs()).toBe(0);
    });

    it("refuses a viewer whose installation names no account id", async () => {
      arrangeInstallation(fake);
      const allowedAccess = {
        users: new Set<bigint>(),
        accounts: new Set([LISTED_ACCOUNT]),
      };

      const res = await paste(buildApp({ allowedAccess }));

      expect(res.status).toBe(403);
    });

    it("refuses a viewer whose listed account's installation is suspended", async () => {
      arrangeInstallation(fake, LISTED_ACCOUNT, true);
      const allowedAccess = {
        users: new Set<bigint>(),
        accounts: new Set([LISTED_ACCOUNT]),
      };

      const res = await paste(buildApp({ allowedAccess }));

      expect(res.status).toBe(403);
    });

    it("leaves two empty lists to Operators alone", async () => {
      arrangeInstallation(fake, LISTED_ACCOUNT);
      const allowedAccess = {
        users: new Set<bigint>(),
        accounts: new Set<bigint>(),
      };

      const refused = await paste(buildApp({ allowedAccess }));
      const operator = await paste(
        buildApp({ allowedAccess, operatorIds: new Set([VIEWER_ID]) }),
      );

      expect(refused.status).toBe(403);
      expect(operator.status).toBe(202);
    });
  });

  describe("when GitHub cannot answer the installation read", () => {
    const listingAccounts = {
      allowedAccess: {
        users: new Set<bigint>(),
        accounts: new Set([LISTED_ACCOUNT]),
      },
    };

    it("fails closed with a 502", async () => {
      fake.failOn("listUserInstallations", FakeFailures.SERVER_ERROR);

      const res = await paste(buildApp(listingAccounts));

      expect(res.status).toBe(502);
      expect(await countGenerateJobs()).toBe(0);
    });

    it("asks for a new sign-in on a dead token", async () => {
      fake.failOn("listUserInstallations", FakeFailures.UNAUTHORIZED);
      stubRefusedTokenRefresh();

      const res = await paste(buildApp(listingAccounts));

      expect(res.status).toBe(401);
      expect(await countGenerateJobs()).toBe(0);
    });
  });
});
