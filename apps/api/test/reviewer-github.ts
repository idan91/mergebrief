// A converted route suite's GitHub: the operation's calls reach the
// `github/testing` fake through the reviewer and installation bindings, while
// the repo gate's own reads and the OAuth refresh still go over `fetch` until
// they move onto the binding too.
import type {
  PrConversation,
  PullRequestInfo,
  ReviewCommentListing,
  ReviewerRepoClient,
} from "github";
import type { FakeGitHub, FakePullRequest, FakeReview } from "github/testing";
import type { KeyProvider } from "persistence";
import type { Mutable } from "types/utils";
import { vi } from "vitest";
import type { AppDeps, AuthDeps } from "../src/index";
import type { InstallationGitHubPort } from "../src/routes/github-port";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  answerUserInstallations,
  brandRepoId,
  buildAuthDeps,
  getRequestUrl,
} from "./fixtures";
import { ACCESS_TOKEN } from "./sign-in";

export const ROTATED_ACCESS_TOKEN = "ghu_ROTATED_ACCESS_PLAINTEXT";

export interface FakePullRequestInfoOptions {
  readonly repoId: number;
  readonly draft?: boolean;
}

/** An open pull request's facts as GitHub reports them. */
export function makeFakePullRequestInfo(
  options: FakePullRequestInfoOptions,
): PullRequestInfo {
  return {
    repoId: brandRepoId(BigInt(options.repoId)),
    repoFullName: REPO_SLUG,
    headSha: "h".repeat(40),
    headRef: "feature",
    baseSha: "b".repeat(40),
    state: "open",
    draft: options.draft ?? false,
    merged: false,
    title: "A pull request",
    body: "",
    htmlUrl: `https://github.com/${REPO_SLUG}/pull/${PR_NUMBER}`,
    commitCount: 1,
    authorLogin: "octocat",
    closedAt: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  };
}

export interface FakePullRequestArrangement {
  readonly repoId: number;
  readonly prNumber?: number;
  /** The slug GitHub holds the PR under; the gate's verified slug by default. */
  readonly fullName?: string;
  /** Absent reads as an empty conversation. */
  readonly conversation?: PrConversation;
  readonly reviews?: readonly FakeReview[];
  readonly reviewComments?: ReviewCommentListing;
}

/** The suites' pull request on `fake`, under the gate's verified slug. */
export function arrangeFakePullRequest(
  fake: FakeGitHub,
  arrangement: FakePullRequestArrangement,
): void {
  const [owner = "", repo = ""] = (arrangement.fullName ?? REPO_SLUG).split(
    "/",
  );
  const pull: Mutable<FakePullRequest> = {
    info: makeFakePullRequestInfo({ repoId: arrangement.repoId }),
  };
  if (arrangement.conversation !== undefined) {
    pull.conversation = arrangement.conversation;
  }
  if (arrangement.reviews !== undefined) {
    pull.reviews = arrangement.reviews;
  }
  if (arrangement.reviewComments !== undefined) {
    pull.reviewComments = arrangement.reviewComments;
  }
  const prNumber = arrangement.prNumber ?? PR_NUMBER;
  fake.addPullRequest({ owner, repo, prNumber }, pull);
}

/** What a mutation's fresh re-resolve reads: the repository by id. */
export function arrangeFakeRepository(
  fake: FakeGitHub,
  repoId: number,
  fullName = REPO_SLUG,
): void {
  fake.addRepository({
    repoId: brandRepoId(BigInt(repoId)),
    fullName,
    private: true,
    viewerCanPush: true,
    viewerIsAdmin: false,
  });
}

/** Methods a suite answers itself, given the fake's own client to delegate to. */
export type RepoClientOverrides = (
  client: ReviewerRepoClient,
) => Partial<ReviewerRepoClient>;

/**
 * The auth bundle with the reviewer binding served by `fake`, each repo
 * client's `overrides` laid over it: for a moment the fake cannot stage,
 * such as a row read while a call is in flight.
 */
export function buildOverriddenAuthDeps(
  kp: KeyProvider,
  fake: FakeGitHub,
  overrides: RepoClientOverrides,
): AuthDeps {
  return {
    ...buildAuthDeps(kp),
    bindReviewerGitHub: (credential, options) => {
      const github = fake.bindReviewerGitHub(credential, options);
      return {
        ...github,
        forRepo(repo) {
          const client = github.forRepo(repo);
          return { ...client, ...overrides(client) };
        },
      };
    },
  };
}

/** The token each fake call carried, in order; an installation call has none. */
export function listFakeCallTokens(fake: FakeGitHub): string[] {
  return fake.calls.map((call) =>
    "token" in call.credential ? call.credential.token : "",
  );
}

/** The auth bundle with the reviewer binding served by `fake`. */
export function buildFakeAuthDeps(kp: KeyProvider, fake: FakeGitHub): AuthDeps {
  return {
    ...buildAuthDeps(kp),
    bindReviewerGitHub: (credential, options) =>
      fake.bindReviewerGitHub(credential, options),
  };
}

function failUnexpected(port: string): never {
  throw new Error(`the ${port} port must not be called in this suite`);
}

/** The App-credential slice of `AppDeps`: the attachment port and the binder. */
export type InstallationDeps = Pick<
  AppDeps,
  "github" | "bindInstallationGitHub"
>;

/** For a suite whose routes make no attachment-branch call. */
export const UNUSED_INSTALLATION_PORT: InstallationGitHubPort = {
  commitAttachment: async () => failUnexpected("attachment"),
  deleteAttachmentBranch: async () => failUnexpected("attachment"),
};

/** For a suite whose routes make no installation-credential call. */
export const UNUSED_INSTALLATION_DEPS: InstallationDeps = {
  github: UNUSED_INSTALLATION_PORT,
  bindInstallationGitHub: () => failUnexpected("installation binding"),
};

/** The installation binding served by `fake`; attachment writes stay unused. */
export function buildFakeInstallationDeps(fake: FakeGitHub): InstallationDeps {
  return {
    github: UNUSED_INSTALLATION_PORT,
    bindInstallationGitHub: (installationId) =>
      fake.bindInstallationGitHub(installationId),
  };
}

export interface GateGitHubOptions {
  readonly repoId: number;
  /** What the gate's repo read answers the viewer's token; 200 by default. */
  readonly viewerStatus?: number;
  /** The installation's listing holds the repo; false is the owner world. */
  readonly inInstallation?: boolean;
  /** `permissions.admin` the gate's read and the walk report, the cached bit. */
  readonly admin?: boolean;
}

export interface GateGitHub {
  /** The gate's `GET /repositories/{id}` reads, every token included. */
  repositoryReads(): number;
  /** Token refreshes against GitHub's OAuth endpoint. */
  tokenRefreshes(): number;
}

function answerJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      date: new Date().toUTCString(),
    },
  });
}

function answerTokenRefresh(): Response {
  return answerJson({
    access_token: ROTATED_ACCESS_TOKEN,
    refresh_token: "ghr_ROTATED_REFRESH_PLAINTEXT",
    expires_in: 28_800,
    refresh_token_expires_in: 15_897_600,
    token_type: "bearer",
    scope: "",
  });
}

function readSentToken(input: string | URL | Request, init?: RequestInit) {
  const headers = new Headers(
    input instanceof Request ? input.headers : init?.headers,
  );
  const authorization = headers.get("authorization") ?? "";
  return authorization.replace(/^(token|Bearer)\s+/i, "");
}

/**
 * The gate's repo read and installation walk, plus the token endpoint. Any
 * token but the viewer's first one reads the repo, so an operator token
 * passes the rung when the viewer is refused.
 */
export function stubGateGitHub(options: GateGitHubOptions): GateGitHub {
  let repositoryReads = 0;
  let tokenRefreshes = 0;
  const admin = options.admin ?? true;
  const repository = {
    id: options.repoId,
    full_name: REPO_SLUG,
    private: true,
    permissions: { admin, push: true, pull: true },
  };
  const listed = options.inInstallation === false ? [] : [repository];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = getRequestUrl(input);
      if (url.includes("/login/oauth/access_token")) {
        tokenRefreshes += 1;
        return answerTokenRefresh();
      }
      const isListing = url.includes("/user/installations/");
      if (isListing && url.includes("/repositories")) {
        return answerJson({ total_count: listed.length, repositories: listed });
      }
      if (url.includes("/user/installations")) {
        return answerUserInstallations([INSTALLATION_ID]);
      }
      if (!url.includes("/repositories/")) {
        throw new Error(`unexpected fetch past the gate: ${url}`);
      }
      repositoryReads += 1;
      const viewerStatus = options.viewerStatus ?? 200;
      const isViewer = readSentToken(input, init) === ACCESS_TOKEN;
      if (isViewer && viewerStatus !== 200) {
        return answerJson({ message: "denied" }, viewerStatus);
      }
      return answerJson(repository);
    }),
  );

  return {
    repositoryReads: () => repositoryReads,
    tokenRefreshes: () => tokenRefreshes,
  };
}
