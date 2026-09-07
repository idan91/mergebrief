import { randomBytes } from "node:crypto";
import {
  GitHubApiErrorCodes,
  createInlineReviewComment,
  createReviewCommentReply,
} from "github";
import type * as githubModule from "github";
import type { Logger } from "logging";
import {
  createEnvKeyProvider,
  encryptToken,
  isGrantRowId,
  isInstallationId,
  isReviewerId,
  WriteClassifications,
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
  AuthChannels,
  type AuthRouteDeps,
  type ViewerPrincipal,
} from "../../../auth/session";
import commentsController from "./controller";

vi.mock("github", async (importOriginal) => ({
  ...(await importOriginal<typeof githubModule>()),
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
    scope: WriteClassifications.EXTERNAL_WRITE,
    channel: AuthChannels.COOKIE,
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

function buildGitHubError(
  code: githubModule.GitHubApiErrorCode,
): Result<never, githubModule.GitHubApiError> {
  return { ok: false, error: { code, status: 403, message: "denied" } };
}

beforeEach(() => {
  vi.mocked(createInlineReviewComment).mockReset();
  vi.mocked(createReviewCommentReply).mockReset();
});

describe("commentsController", () => {
  it("wraps a publish denial whole with phase mutation", async () => {
    vi.mocked(createInlineReviewComment).mockResolvedValue({
      ok: false,
      error: {
        code: GitHubApiErrorCodes.FORBIDDEN,
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
      buildGitHubError(GitHubApiErrorCodes.NOT_FOUND),
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
        error: { code: GitHubApiErrorCodes.NOT_FOUND },
      },
    });
  });
});
