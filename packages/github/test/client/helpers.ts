import { vi, type Mock } from "vitest";
import type { Logger } from "logging";
import {
  createUserOctokit,
  type UserOctokitFactory,
} from "../../src/auth/oauth";
import type { InstallationId, RepoId } from "persistence";
import { isOperatorToken } from "../../src/client/operator";
import type { OperatorToken, ReviewerCredential } from "../../src/client/types";
import { isInstallationId, isRepoId } from "../../src/ids";

export interface RecordedRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | undefined;
}

export interface StubResponse {
  readonly status: number;
  readonly body: unknown;
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
        headers: { "content-type": "application/json" },
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
  readonly warn: ReturnType<typeof vi.fn>;
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

/** A credential holding `token` whose renewal answers `renewed`. */
export function stubCredential(
  token: string,
  renewed: string | undefined,
): CredentialStub {
  return {
    readToken: vi.fn<ReviewerCredential["readToken"]>(async () => ({
      ok: true,
      value: token,
    })),
    renewToken: vi.fn<ReviewerCredential["renewToken"]>(async () => renewed),
  };
}

export const REPO = { owner: "acme", repo: "widgets" } as const;

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

export function requireOperatorToken(value: string): OperatorToken {
  if (!isOperatorToken(value)) {
    throw new Error("test operator token must be non-empty");
  }
  return value;
}
