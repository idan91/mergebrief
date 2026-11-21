import { generateKeyPairSync } from "node:crypto";
import { App, Octokit } from "octokit";
import { vi, type Mock } from "vitest";
import type { Logger } from "logging";
import {
  createUserOctokit,
  type UserOctokitFactory,
} from "../../src/auth/oauth";
import type { InstallationId, RepoId, ReviewerId } from "persistence";
import type { Result } from "types/utils";
import { isOperatorToken } from "../../src/client/operator";
import {
  RenewalFailureCodes,
  type OperatorToken,
  type RenewalFailure,
  type ReviewerCredential,
} from "../../src/client/types";
import type { GitHubConfig } from "../../src/config";
import { isInstallationId, isRepoId, isReviewerId } from "../../src/ids";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  /** The query string, `?` included; empty when none. */
  readonly search: string;
  readonly authorization: string | undefined;
}

export interface StubResponse {
  readonly status: number;
  readonly body: unknown;
  /** The body as GitHub's bytes, for digits `JSON.stringify` could not print. */
  readonly rawBody?: string;
  readonly headers?: Readonly<Record<string, string>>;
}

/** `undefined` holds the request unanswered until its signal aborts. */
export type RouteHandler = (
  request: RecordedRequest,
) => StubResponse | undefined;

export interface GitHubFetchStub {
  readonly fetch: typeof fetch;
  readonly requests: RecordedRequest[];
}

function readAuthorization(init: RequestInit | undefined): string | undefined {
  const headers = new Headers(init?.headers);
  return headers.get("authorization") ?? undefined;
}

function holdUntilAborted(signal: AbortSignal | null | undefined) {
  return new Promise<Response>((_resolve, reject) => {
    signal?.addEventListener("abort", () => reject(signal.reason), {
      once: true,
    });
  });
}

function isRedirectStatus(status: number): boolean {
  const redirect = status >= 300 && status < 400;
  return redirect;
}

/**
 * A fetch that answers every request through `route` and records it. A 3xx
 * carrying `location` is followed as fetch follows it, unless the request
 * set `redirect` to `manual` (answered as is) or `error` (rejected).
 */
export function stubGitHubFetch(route: RouteHandler): GitHubFetchStub {
  const requests: RecordedRequest[] = [];
  async function answerRequest(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<Response> {
    const url = new URL(input instanceof Request ? input.url : input);
    const request = {
      method: init?.method ?? "GET",
      path: url.pathname,
      search: url.search,
      authorization: readAuthorization(init),
    };
    requests.push(request);
    const answer = route(request);
    if (answer === undefined) {
      return holdUntilAborted(init?.signal);
    }

    const location = answer.headers?.["location"];
    const followed = isRedirectStatus(answer.status) && location !== undefined;
    if (followed && init?.redirect === "error") {
      throw new TypeError("fetch failed", { cause: "unexpected redirect" });
    }
    if (followed && init?.redirect !== "manual") {
      return answerRequest(new URL(location, url), init);
    }
    return new Response(answer.rawBody ?? JSON.stringify(answer.body), {
      status: answer.status,
      headers: { "content-type": "application/json", ...answer.headers },
    });
  }
  return { fetch: vi.fn(answerRequest), requests };
}

/** The real user-octokit construction, unthrottled, over a stubbed fetch. */
export function makeOctokitFactory(stub: GitHubFetchStub): UserOctokitFactory {
  return (token, options) =>
    createUserOctokit(token, {
      ...options,
      throttle: false,
      fetch: stub.fetch,
    });
}

export function makeLogger(): Logger & {
  readonly error: ReturnType<typeof vi.fn>;
  readonly warn: ReturnType<typeof vi.fn>;
  readonly info: ReturnType<typeof vi.fn>;
  readonly debug: ReturnType<typeof vi.fn>;
} {
  const logger = {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(),
  };
  logger.child.mockReturnValue(logger);
  return logger;
}

export interface CredentialStub extends ReviewerCredential {
  readonly readToken: Mock<ReviewerCredential["readToken"]>;
  readonly renewToken: Mock<ReviewerCredential["renewToken"]>;
}

/**
 * A credential holding `token`: a string renewal rotates to it, a failure
 * answers it, and `undefined` refuses.
 */
export function stubCredential(
  token: string,
  renewed: string | RenewalFailure | undefined,
): CredentialStub {
  return {
    readToken: vi.fn<ReviewerCredential["readToken"]>(async () => ({
      ok: true,
      value: token,
    })),
    renewToken: vi.fn<ReviewerCredential["renewToken"]>(async () =>
      shapeRenewal(renewed),
    ),
  };
}

function shapeRenewal(
  renewed: string | RenewalFailure | undefined,
): Result<string, RenewalFailure> {
  if (typeof renewed === "string") {
    return { ok: true, value: renewed };
  }
  return {
    ok: false,
    error: renewed ?? { code: RenewalFailureCodes.REFUSED },
  };
}

export const REPO = { owner: "acme", repo: "widgets" } as const;

export const OLD_TOKEN = "ghu_old";
export const OPERATOR_TOKEN = "ghp_operator";
export const UNAUTHORIZED = {
  status: 401,
  body: { message: "Bad credentials" },
};
export const NOT_FOUND = { status: 404, body: { message: "Not Found" } };

/** Answers each request by the token it carries; an unknown token gets a 500. */
export function answerByToken(
  answers: Readonly<Record<string, StubResponse>>,
): RouteHandler {
  return (request) => {
    const token = request.authorization?.replace("token ", "") ?? "";
    return answers[token] ?? { status: 500, body: { message: "unrouted" } };
  };
}

export function makeRepositoryBody(fullName: string): unknown {
  return {
    full_name: fullName,
    private: true,
    permissions: { push: true, admin: false },
  };
}

export function makePullRequestBody(prNumber: number): unknown {
  return {
    number: prNumber,
    state: "open",
    draft: false,
    merged: false,
    title: "Add widgets",
    body: null,
    html_url: `https://github.com/acme/widgets/pull/${prNumber}`,
    commits: 2,
    changed_files: 1,
    additions: 8,
    deletions: 2,
    labels: [{ name: "needs-brief" }],
    requested_reviewers: [{ login: "hubot" }],
    requested_teams: [],
    user: { login: "octocat" },
    closed_at: null,
    updated_at: "2026-10-01T10:00:00Z",
    created_at: "2026-09-01T08:00:00Z",
    head: { sha: "b".repeat(40), ref: "feature", repo: null },
    base: {
      sha: "a".repeat(40),
      ref: "main",
      repo: {
        id: 4242,
        full_name: "acme/widgets",
        name: "widgets",
        owner: { login: "acme" },
      },
    },
  };
}

export const PULL = { status: 200, body: makePullRequestBody(7) };

export function formatTokenAuthorization(token: string): string {
  return `token ${token}`;
}

export function requireRepoId(value: bigint): RepoId {
  if (!isRepoId(value)) {
    throw new Error("test repo id must be positive");
  }
  return value;
}

export function requireInstallationId(value: bigint): InstallationId {
  if (!isInstallationId(value)) {
    throw new Error("test installation id must be positive");
  }
  return value;
}

export function requireReviewerId(value: bigint): ReviewerId {
  if (!isReviewerId(value)) {
    throw new Error("test reviewer id must be positive");
  }
  return value;
}

export function requireOperatorToken(value: string): OperatorToken {
  if (!isOperatorToken(value)) {
    throw new Error("test operator token must be non-empty");
  }
  return value;
}

export const MINTED = "ghs_minted";
export const MINT_PATH = "/app/installations/99/access_tokens";
export const MINT_OK = {
  status: 201,
  body: { token: MINTED, expires_at: "2099-01-01T00:00:00Z" },
};

function makeThrowawayPrivateKey(): string {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  return privateKey.export({ type: "pkcs1", format: "pem" }).toString();
}

let privateKey: string | undefined;

/** Production config for `createAppClient` (App id 1) with a throwaway key. */
export function makeAppConfig(): GitHubConfig {
  privateKey ??= makeThrowawayPrivateKey();
  return {
    appId: 1,
    privateKey,
    webhookSecret: "a".repeat(64),
    oauthClientId: "Iv1.client",
    oauthClientSecret: "client-secret",
    appSlug: undefined,
  };
}

/** An unthrottled App (id 1) whose requests go through `stub`. */
export function makeApp(stub: GitHubFetchStub): App {
  privateKey ??= makeThrowawayPrivateKey();
  return new App({
    appId: 1,
    privateKey,
    Octokit: Octokit.defaults({
      request: { fetch: stub.fetch },
      throttle: { enabled: false },
    }),
  });
}

/** Answers installation 99's token mint with `minted`, the rest with `answer`. */
export function routeMinting(
  minted: StubResponse,
  answer: StubResponse,
): RouteHandler {
  return (request) => {
    if (request.path === MINT_PATH) {
      return minted;
    }
    return answer;
  };
}
