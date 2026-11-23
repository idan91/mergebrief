// A route suite's GitHub: the gate's reads and the operation's calls reach
// the `github/testing` fake through the reviewer, operator and installation
// bindings; only the OAuth refresh endpoint still goes over `fetch`.
import type {
  InstallationRepository,
  PrConversation,
  PullRequestInfo,
  ReviewCommentListing,
  ReviewerRepoClient,
  UserInstallation,
} from "github";
import {
  CredentialKinds,
  FakeFailures,
  type FakeFailure,
  type FakeGitHub,
  type FakeGitHubCall,
  type FakePullRequest,
  type FakeReview,
  type GitHubOperation,
} from "github/testing";
import type { KeyProvider, RepoId } from "persistence";
import type { Mutable } from "types/utils";
import { vi } from "vitest";
import type { AppDeps, AuthDeps } from "../src/index";
import {
  INSTALLATION_ID,
  PR_NUMBER,
  REPO_SLUG,
  REVIEWER_ID,
  brandInstallationId,
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
    repoPrivate: false,
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
    changedFiles: 1,
    additions: 8,
    deletions: 2,
    labels: [],
    pendingReviewRequests: 0,
    authorLogin: "octocat",
    authorIsBot: false,
    closedAt: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    createdAt: new Date("2025-12-01T00:00:00Z"),
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
  readonly rejectedAnchorPaths?: readonly string[];
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
  if (arrangement.rejectedAnchorPaths !== undefined) {
    pull.rejectedAnchorPaths = arrangement.rejectedAnchorPaths;
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
    ...buildFakeAuthDeps(kp, fake),
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

/** The token each call carried, in order; an installation call has none. */
export function listCallTokens(calls: readonly FakeGitHubCall[]): string[] {
  return calls.map((call) =>
    "token" in call.credential ? call.credential.token : "",
  );
}

/** The token each fake call carried, the gate's included. */
export function listFakeCallTokens(fake: FakeGitHub): string[] {
  return listCallTokens(fake.calls);
}

/** A cold gate pass on the viewer's token: the repo read, then the walk. */
export const REVIEWER_GATE_CALLS: readonly GitHubOperation[] = [
  "fetchRepositoryById",
  "listUserInstallations",
  "listInstallationRepositories",
];

/** A cold gate pass on the operator rung: the viewer refused, the PAT read. */
export const OPERATOR_GATE_CALLS: readonly GitHubOperation[] = [
  "fetchRepositoryById",
  "fetchRepositoryById",
];

/** A gate that refused the viewer with no rung to take. */
export const DENIED_GATE_CALLS: readonly GitHubOperation[] = [
  "fetchRepositoryById",
];

/**
 * The calls after one request's gate pass, which must open the call list
 * exactly as `gateCalls` names it; the reviewer pass by default.
 */
export function listCallsPastGate(
  fake: FakeGitHub,
  gateCalls: readonly GitHubOperation[] = REVIEWER_GATE_CALLS,
): FakeGitHubCall[] {
  const opening = fake.calls
    .slice(0, gateCalls.length)
    .map((call) => call.operation);
  const isGatePass = opening.join() === gateCalls.join();
  if (!isGatePass) {
    throw new Error(`the calls open ${opening.join()}, not the gate's pass`);
  }
  return fake.calls.slice(gateCalls.length);
}

/** The auth bundle with the reviewer and operator bindings served by `fake`. */
export function buildFakeAuthDeps(kp: KeyProvider, fake: FakeGitHub): AuthDeps {
  return {
    ...buildAuthDeps(kp),
    bindReviewerGitHub: (credential, options) =>
      fake.bindReviewerGitHub(credential, options),
    bindOperatorGitHub: (token, options) =>
      fake.bindOperatorGitHub(token, options),
  };
}

/** For a suite whose GitHub is the fake alone: any `fetch` fails the test. */
export function stubNoNetwork(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      throw new Error(`unexpected fetch: ${getRequestUrl(input)}`);
    }),
  );
}

function failUnexpected(port: string): never {
  throw new Error(`the ${port} port must not be called in this suite`);
}

/** The App-credential slice of `AppDeps`: the installation binder and presence read. */
export type InstallationDeps = Pick<
  AppDeps,
  "bindInstallationGitHub" | "readInstallationPresence"
>;

/** For a suite whose routes make no App-credential call. */
export const UNUSED_INSTALLATION_DEPS: InstallationDeps = {
  bindInstallationGitHub: () => failUnexpected("installation binding"),
  readInstallationPresence: () => failUnexpected("installation presence"),
};

/** The instance closes to everyone it omits, so a suite lists its reviewer. */
export const LISTED_REVIEWER_DEPS = {
  allowedAccess: {
    users: new Set([BigInt(REVIEWER_ID)]),
    accounts: new Set<bigint>(),
  },
};

/** The installation binding and presence read served by `fake`. */
export function buildFakeInstallationDeps(fake: FakeGitHub): InstallationDeps {
  return {
    bindInstallationGitHub: (installationId) =>
      fake.bindInstallationGitHub(installationId),
    readInstallationPresence: (installationId) =>
      fake.readInstallationPresence(installationId),
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
  /** `permissions.push`, the gate's push bit; true by default. */
  readonly push?: boolean;
  /** The name GitHub verifies for the repo; the suites' slug by default. */
  readonly fullName?: string;
  /** The installation's account id, which `allowed.accounts` matches. */
  readonly accountId?: bigint;
}

export interface GateGitHub {
  /** Every `fetchRepositoryById` on the fake: the gate's, the rung's, a re-resolve's. */
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

export interface OAuthErrorBody {
  readonly error: string;
  readonly error_description: string;
  readonly error_uri: string;
}

/** The body GitHub's OAuth token endpoint answers a refusal with. */
export function makeOAuthErrorBody(error: string): OAuthErrorBody {
  return {
    error,
    error_description: "GitHub refused the request.",
    error_uri: "https://docs.github.com/apps",
  };
}

/** GitHub's answer refusing a rotation: the grant's refresh token is spent. */
export const BAD_REFRESH_TOKEN_BODY = makeOAuthErrorBody("bad_refresh_token");

interface TokenSuccess {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  refresh_token_expires_in: number;
  token_type: string;
  scope: string;
}
type TokenBody = TokenSuccess | OAuthErrorBody;

export function makeTokenSuccess(
  access: string,
  refresh: string,
): TokenSuccess {
  return {
    access_token: access,
    refresh_token: refresh,
    expires_in: 28_800, // ~8h
    refresh_token_expires_in: 15_897_600, // ~6mo
    token_type: "bearer",
    scope: "",
  };
}

interface SignInStubOptions {
  readonly token: TokenBody;
  readonly tokenStatus?: number;
  readonly installations?: { id: number; accountId?: number }[];
  readonly installationsStatus?: number;
  readonly user?: { id: number; login: string };
  readonly userStatus?: number;
}

/** Install a fetch stub answering the three GitHub endpoints the flow hits. */
export function stubGitHub(opts: SignInStubOptions): ReturnType<typeof vi.fn> {
  const fetchFn = vi.fn(
    async (
      input: string | URL | Request,
      _init?: RequestInit,
    ): Promise<Response> => {
      const url = getRequestUrl(input);
      if (url.includes("/login/oauth/access_token")) {
        return answerJson(opts.token, opts.tokenStatus);
      }
      const userReadFails =
        url.endsWith("/user") && opts.userStatus !== undefined;
      if (userReadFails) {
        return answerJson({ message: "unavailable" }, opts.userStatus);
      }
      if (url.endsWith("/user")) {
        return answerJson(opts.user ?? { id: REVIEWER_ID, login: "octocat" });
      }
      if (url.includes("/user/installations")) {
        if (opts.installationsStatus !== undefined) {
          return answerJson(
            { message: "unavailable" },
            opts.installationsStatus,
          );
        }
        const installations = (
          opts.installations ?? [{ id: INSTALLATION_ID }]
        ).map((installation) => ({
          id: installation.id,
          account: {
            id: installation.accountId,
            login: `org-${installation.id}`,
          },
        }));
        return answerJson({
          total_count: installations.length,
          installations,
        });
      }
      return answerJson({ message: "unexpected endpoint" }, 404);
    },
  );
  vi.stubGlobal("fetch", fetchFn);
  return fetchFn;
}

/** OAuth's token endpoint answers every rotation with `body`. */
export function stubTokenRefreshAnswer(body: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = getRequestUrl(input);
      if (!url.includes("/login/oauth/access_token")) {
        throw new Error(`unexpected fetch: ${url}`);
      }
      return answerJson(body);
    }),
  );
}

/** GitHub refuses the rotation: the grant's refresh token is spent for good. */
export function stubRefusedTokenRefresh(): void {
  stubTokenRefreshAnswer(BAD_REFRESH_TOKEN_BODY);
}

const VIEWER_REFUSALS: Record<number, FakeFailure> = {
  403: FakeFailures.FORBIDDEN,
  404: FakeFailures.NOT_FOUND,
  429: FakeFailures.RATE_LIMITED,
  502: FakeFailures.SERVER_ERROR,
};

function refuseViewer(fake: FakeGitHub, viewerStatus: number): void {
  if (viewerStatus === 401) {
    fake.rejectToken(ACCESS_TOKEN);
    return;
  }
  const failure = VIEWER_REFUSALS[viewerStatus];
  if (failure === undefined) {
    throw new Error(`no fake refusal for status ${viewerStatus}`);
  }
  fake.failOn("fetchRepositoryById", failure, CredentialKinds.REVIEWER);
}

/** OAuth's token endpoint, the one GitHub surface the fake does not model. */
export function stubTokenRefresh(): () => number {
  let tokenRefreshes = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = getRequestUrl(input);
      if (!url.includes("/login/oauth/access_token")) {
        throw new Error(`unexpected fetch: ${url}`);
      }
      tokenRefreshes += 1;
      return answerTokenRefresh();
    }),
  );
  return () => tokenRefreshes;
}

/**
 * The repo the gate reads and the installation its walk finds it in, on
 * `fake`. A refused viewer leaves the repo readable by any other credential,
 * so an operator token passes the rung.
 */
export function arrangeFakeGate(
  fake: FakeGitHub,
  options: GateGitHubOptions,
): GateGitHub {
  const repoId = brandRepoId(BigInt(options.repoId));
  const fullName = options.fullName ?? REPO_SLUG;
  const admin = options.admin ?? true;
  fake.addRepository({
    repoId,
    fullName,
    private: true,
    viewerCanPush: options.push ?? true,
    viewerIsAdmin: admin,
  });
  const listed = new Map<RepoId, InstallationRepository>();
  if (options.inInstallation !== false) {
    listed.set(repoId, {
      fullName,
      viewerIsAdmin: admin,
      viewerCanPush: options.push ?? true,
    });
  }
  const installation: Mutable<UserInstallation> = {
    installationId: brandInstallationId(BigInt(INSTALLATION_ID)),
    accountLogin: `org-${INSTALLATION_ID}`,
  };
  if (options.accountId !== undefined) {
    installation.accountId = options.accountId;
  }
  fake.addInstallation(installation, listed);
  if (options.viewerStatus !== undefined && options.viewerStatus !== 200) {
    refuseViewer(fake, options.viewerStatus);
  }

  const tokenRefreshes = stubTokenRefresh();
  return {
    repositoryReads: () => fake.listCalls("fetchRepositoryById").length,
    tokenRefreshes,
  };
}
