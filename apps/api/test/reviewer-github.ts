// A converted route suite's GitHub: the operation's calls reach the
// `github/testing` fake through the reviewer binding, while the repo gate's
// own reads and the OAuth refresh still go over `fetch` until they move onto
// the binding too.
import type { FakeGitHub } from "github/testing";
import type { KeyProvider } from "persistence";
import { vi } from "vitest";
import type { AuthDeps } from "../src/index";
import type { InstallationGitHubPort } from "../src/routes/github-port";
import {
  INSTALLATION_ID,
  REPO_SLUG,
  answerUserInstallations,
  buildAuthDeps,
  getRequestUrl,
} from "./fixtures";
import { ACCESS_TOKEN } from "./sign-in";

export const ROTATED_ACCESS_TOKEN = "ghu_ROTATED_ACCESS_PLAINTEXT";

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

/** For a suite whose routes make no installation-credential call. */
export const UNUSED_INSTALLATION_PORT: InstallationGitHubPort = {
  fetchPullRequestConversation: async () => failUnexpected("conversation"),
  listRepoCollaborators: async () => failUnexpected("collaborators"),
  commitAttachment: async () => failUnexpected("attachment"),
  deleteAttachmentBranch: async () => failUnexpected("attachment"),
};

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
