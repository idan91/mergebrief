import { randomBytes } from "node:crypto";
import {
  GitHubApiErrorCode,
  createInlineReviewComment,
  createReviewCommentReply,
  fetchRepositoryById,
} from "github";
import type * as githubModule from "github";
import type { Logger } from "logging";
import {
  createEnvKeyProvider,
  encryptToken,
  isGrantRowId,
  isInstallationId,
  isRepoId,
  isReviewerId,
  WriteClassification,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import type { Result } from "types";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { createReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import {
  AuthChannel,
  type AuthRouteDeps,
  type ViewerPrincipal,
} from "../../../auth/session";
import commentsController from "./controller";

vi.mock("github", async (importOriginal) => ({
  ...(await importOriginal<typeof githubModule>()),
  fetchRepositoryById: vi.fn(),
  createInlineReviewComment: vi.fn(),
  createReviewCommentReply: vi.fn(),
}));

const KEY_REF = "SESSION_KEY_TEST";
const keyProvider = createEnvKeyProvider({
  [KEY_REF]: randomBytes(32).toString("base64"),
});

const log: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => log,
};

function parseFixtureBrand<T extends bigint>(
  value: bigint,
  guard: (v: bigint) => v is T,
): T {
  if (!guard(value)) {
    throw new Error("unbrandable fixture value");
  }
  return value;
}

let harness: PgliteHarness;
beforeAll(async () => {
  harness = await createPgliteHarness();
});
afterAll(async () => {
  await harness.close();
});

async function buildClient(ciphertextOverride?: string) {
  const sealed = await encryptToken(keyProvider, KEY_REF, "viewer-token");
  if (!sealed.ok) {
    throw new Error("fixture seal failed");
  }
  const session: ViewerPrincipal = {
    id: 1n,
    installationId: parseFixtureBrand(10n, isInstallationId),
    sessionTokenHash: "hash-comments-unit",
    reviewerId: parseFixtureBrand(42n, isReviewerId),
    reviewerLogin: "octocat",
    grantId: parseFixtureBrand(7n, isGrantRowId),
    expiresAt: new Date(Date.now() + 60_000),
    createdAt: new Date(),
    ghTokenCiphertext: ciphertextOverride ?? sealed.value,
    keyRef: KEY_REF,
    scope: WriteClassification.EXTERNAL_WRITE,
    channel: AuthChannel.COOKIE,
  };
  const deps: AuthRouteDeps = {
    handle: harness.handle,
    auth: {
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
      keyProvider,
      sessionKeyRef: KEY_REF,
      publicBaseUrl: "https://example.test",
      cookieSecure: false,
    },
  };
  return createReviewerGitHubClient(deps, session, log);
}

const REPO_ID = (() => {
  const value = 4321n;
  if (!isRepoId(value)) {
    throw new Error("unbrandable repo id");
  }
  return value;
})();

function buildGitHubError(
  code: githubModule.GitHubApiErrorCode,
): Result<never, githubModule.GitHubApiError> {
  return { ok: false, error: { code, status: 403, message: "denied" } };
}

beforeEach(() => {
  vi.mocked(fetchRepositoryById).mockReset();
  vi.mocked(createInlineReviewComment).mockReset();
  vi.mocked(createReviewCommentReply).mockReset();
});

describe("commentsController", () => {
  it("wraps a fresh-resolve denial whole with phase resolve", async () => {
    vi.mocked(fetchRepositoryById).mockResolvedValue(
      buildGitHubError(GitHubApiErrorCode.FORBIDDEN),
    );
    const result = await commentsController.resolveFreshRepoTarget(
      { github: await buildClient() },
      REPO_ID,
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "github-denied",
        phase: "resolve",
        error: { code: GitHubApiErrorCode.FORBIDDEN },
      },
    });
  });

  it("reports an unreadable stored token before any GitHub call", async () => {
    const result = await commentsController.resolveFreshRepoTarget(
      { github: await buildClient("not-a-ciphertext") },
      REPO_ID,
    );
    expect(result).toEqual({
      ok: false,
      error: { kind: "token-unreadable" },
    });
    expect(fetchRepositoryById).not.toHaveBeenCalled();
  });

  it("splits the verified full name on success", async () => {
    vi.mocked(fetchRepositoryById).mockResolvedValue({
      ok: true,
      value: {
        repoId: REPO_ID,
        fullName: "acme/app",
        private: false,
        viewerCanPush: true,
      },
    });
    const result = await commentsController.resolveFreshRepoTarget(
      { github: await buildClient() },
      REPO_ID,
    );
    expect(result).toEqual({
      ok: true,
      value: { owner: "acme", repo: "app" },
    });
  });

  it("wraps a publish denial whole with phase mutation", async () => {
    vi.mocked(createInlineReviewComment).mockResolvedValue({
      ok: false,
      error: {
        code: GitHubApiErrorCode.FORBIDDEN,
        status: 403,
        message: "denied",
        staleAnchor: false,
      },
    });
    const result = await commentsController.postInlineComment(
      { github: await buildClient() },
      {
        owner: "acme",
        repo: "app",
        prNumber: 7,
        commitId: "a".repeat(40),
        path: "src/x.ts",
        line: 3,
        side: "RIGHT",
        body: "note",
      },
    );
    expect(result).toMatchObject({
      ok: false,
      error: { kind: "github-denied", phase: "mutation" },
    });
  });

  it("wraps a reply denial whole with phase mutation", async () => {
    vi.mocked(createReviewCommentReply).mockResolvedValue(
      buildGitHubError(GitHubApiErrorCode.NOT_FOUND),
    );
    const result = await commentsController.postReply(
      { github: await buildClient() },
      { owner: "acme", repo: "app", prNumber: 7, commentId: 5, body: "reply" },
    );
    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "github-denied",
        phase: "mutation",
        error: { code: GitHubApiErrorCode.NOT_FOUND },
      },
    });
  });
});
