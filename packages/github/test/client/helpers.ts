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
import { isInstallationId, isRepoId, isReviewerId } from "../../src/ids";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
}

export interface StubResponse {
  readonly status: number;
  readonly body: unknown;
  readonly headers?: Readonly<Record<string, string>>;
}

export type RouteHandler = (request: RecordedRequest) => StubResponse;

export interface GitHubFetchStub {
  readonly fetch: typeof fetch;
  readonly requests: RecordedRequest[];
}

function readAuthorization(init: RequestInit | undefined): string | undefined {
  const headers = new Headers(init?.headers);
  return headers.get("authorization") ?? undefined;
}

/** A fetch that answers every request through `route` and records it. */
export function stubGitHubFetch(route: RouteHandler): GitHubFetchStub {
  const requests: RecordedRequest[] = [];
  const stubbed = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : input);
      const request = {
        method: init?.method ?? "GET",
        path: url.pathname,
        authorization: readAuthorization(init),
      };
      requests.push(request);
      const answer = route(request);
      return new Response(JSON.stringify(answer.body), {
        status: answer.status,
        headers: { "content-type": "application/json", ...answer.headers },
      });
    },
  );
  return { fetch: stubbed, requests };
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
    user: { login: "octocat" },
    closed_at: null,
    updated_at: "2026-10-01T10:00:00Z",
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
