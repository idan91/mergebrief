import {
  CredentialKinds,
  FakeFailures,
  makeFakeGitHub,
  type FakeGitHub,
} from "github/testing";
import type { Logger } from "logging";
import {
  encryptToken,
  isRepoId,
  isReviewerId,
  isGrantRowId,
  WriteClassifications,
  type AppDatabase,
  type RepoId,
} from "persistence";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  KEY_REF,
  buildAuthDeps,
  buildOperatorToken,
  createKeyProvider,
} from "../../test/fixtures";
import {
  AuthChannels,
  type AuthRouteDeps,
  type ViewerPrincipal,
} from "../routes/auth/session/types";
import {
  bindGrantedPullRequestGitHub,
  bindRequestGitHub,
} from "./reviewer-binding";
import { AccessFootings, type RepoAccess } from "./types";

const VIEWER_TOKEN = "ghu_viewer";
const OPERATOR_PAT = "ghp_operator";
const GRANTED_PR = 7;
const REPO = { owner: "octo", repo: "hello" };
const KNOWN_LOOKING_SHA = "a".repeat(40);

const log: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => log,
};

function brandRepoId(value: bigint): RepoId {
  if (!isRepoId(value)) {
    throw new Error("fixture repo id failed its guard");
  }
  return value;
}

async function makeSession(kp: AuthRouteDeps["auth"]["keyProvider"]) {
  const sealed = await encryptToken(kp, KEY_REF, VIEWER_TOKEN);
  const reviewerId = BigInt(555);
  const grantId = BigInt(1);
  if (!sealed.ok || !isReviewerId(reviewerId) || !isGrantRowId(grantId)) {
    throw new Error("fixture session failed its guards");
  }
  const session: ViewerPrincipal = {
    id: 1n,
    sessionTokenHash: "hash",
    reviewerId,
    reviewerLogin: "octocat",
    grantId,
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ghTokenCiphertext: sealed.value,
    keyRef: KEY_REF,
    scope: WriteClassifications.READ,
    channel: AuthChannels.COOKIE,
  };
  return session;
}

function listTokens(fake: FakeGitHub): string[] {
  return fake.calls.map((call) =>
    "token" in call.credential ? call.credential.token : "",
  );
}

describe("bindGrantedPullRequestGitHub", () => {
  let fake: FakeGitHub;
  let deps: AuthRouteDeps;
  let session: ViewerPrincipal;

  beforeEach(async () => {
    fake = makeFakeGitHub();
    const kp = createKeyProvider();
    session = await makeSession(kp);
    deps = {
      // The credential touches the table only on a refresh or a bad token.
      handle: {} as AppDatabase,
      auth: {
        ...buildAuthDeps(kp),
        bindReviewerGitHub: (credential, options) =>
          fake.bindReviewerGitHub(credential, options),
      },
      operatorToken: buildOperatorToken(OPERATOR_PAT),
    };
    fake.failOn(
      "fetchRenderedImageSources",
      FakeFailures.NOT_FOUND,
      CredentialKinds.REVIEWER,
    );
    fake.failOn(
      "fetchRepoFile",
      FakeFailures.NOT_FOUND,
      CredentialKinds.REVIEWER,
    );
  });

  function makeAccess(footing: RepoAccess["footing"]): RepoAccess {
    const shared = {
      session,
      repoId: brandRepoId(424242n),
      repoFullName: "octo/hello",
      installation: { kind: "owner" },
      ...bindRequestGitHub(deps, session, log),
    } as const;
    if (footing === AccessFootings.OPERATOR) {
      const prNumber = GRANTED_PR;
      return { ...shared, footing, prNumber, viewerCanPush: false };
    }
    return { ...shared, footing, viewerCanPush: true };
  }

  it("retries the granted pull request's denied read on the operator", async () => {
    const access = makeAccess(AccessFootings.OPERATOR);
    const github = bindGrantedPullRequestGitHub(deps, access, log);

    await github.forRepo(REPO).fetchRenderedImageSources(GRANTED_PR);

    expect(listTokens(fake)).toEqual([VIEWER_TOKEN, OPERATOR_PAT]);
  });

  it("keeps another pull request's denied read on the viewer", async () => {
    const access = makeAccess(AccessFootings.OPERATOR);
    const github = bindGrantedPullRequestGitHub(deps, access, log);

    const read = await github.forRepo(REPO).fetchRenderedImageSources(8);

    expect(read.ok).toBe(false);
    expect(listTokens(fake)).toEqual([VIEWER_TOKEN]);
  });

  it("knows no commit without the row, so a ref read stays the viewer's", async () => {
    const access = makeAccess(AccessFootings.OPERATOR);
    const github = bindGrantedPullRequestGitHub(deps, access, log);

    await github
      .forRepo(REPO)
      .fetchRepoFile({ path: "a.ts", ref: KNOWN_LOOKING_SHA, maxBytes: 10 });

    expect(listTokens(fake)).toEqual([VIEWER_TOKEN]);
  });

  it("answers a reviewer-footed access with its own binding", () => {
    const access = makeAccess(AccessFootings.REVIEWER);

    expect(bindGrantedPullRequestGitHub(deps, access, log)).toBe(access.github);
  });
});
