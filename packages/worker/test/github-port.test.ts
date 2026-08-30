// The url-box credential path: grant → lazy decrypt → viewer octokit, with
// the operator PAT as the probe-decided backstop. GitHub is mocked at the
// module boundary; the grant/crypto legs run real against PGlite.
import { randomBytes } from "node:crypto";
import type * as githubModule from "github";
import {
  GitHubApiErrorCodes,
  createUserOctokit,
  fetchPullRequest,
} from "github";
import {
  createEnvKeyProvider,
  createGrantAuth,
  encryptToken,
  isGrantRowId,
  isRepoId,
  type GrantRowId,
  type RepoId,
} from "persistence";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PermanentJobError } from "../src/task/failure";
import { appGitHubPort } from "../src/task/github-port";

vi.mock("github", async (importOriginal) => ({
  ...(await importOriginal<typeof githubModule>()),
  createUserOctokit: vi.fn(),
  fetchPullRequest: vi.fn(),
}));

function brandRepoId(value: bigint): RepoId {
  if (!isRepoId(value)) throw new Error("bad repo id");
  return value;
}

const KEY_REF = "SESSION_KEY_TEST";
const keyProvider = createEnvKeyProvider({
  [KEY_REF]: randomBytes(32).toString("base64"),
});

// The App client is never touched on the url-box path; a call is a test bug.
const unusedApp = new Proxy(
  {},
  {
    get() {
      throw new Error("App client must not be used on the url-box path");
    },
  },
) as githubModule.AppClient;

const INFO: githubModule.PullRequestInfo = {
  repoId: brandRepoId(7n),
  repoFullName: "acme/widget",
  headSha: "a".repeat(40),
  baseSha: "c".repeat(40),
  state: "open",
  draft: false,
  merged: false,
  title: "t",
  body: "",
  htmlUrl: "https://github.com/acme/widget/pull/7",
  commitCount: 1,
  authorLogin: "octocat",
  closedAt: null,
};

/** Track which token each minted octokit carries. */
const octokitTokens = new WeakMap<object, string>();

function stubOctokits(): void {
  vi.mocked(createUserOctokit).mockImplementation((token: string) => {
    const octokit = {};
    octokitTokens.set(octokit, token);
    return octokit as ReturnType<typeof createUserOctokit>;
  });
}

function tokenOf(octokit: unknown): string | undefined {
  return typeof octokit === "object" && octokit !== null
    ? octokitTokens.get(octokit)
    : undefined;
}

let harness: PgliteHarness;
beforeEach(async () => {
  harness = await createPgliteHarness();
  stubOctokits();
});
afterEach(async () => {
  vi.clearAllMocks();
  await harness.close();
});

async function seedGrant(
  plaintext: string,
  keyRef = KEY_REF,
): Promise<GrantRowId> {
  const sealedAccess = await encryptToken(keyProvider, KEY_REF, plaintext);
  const sealedRefresh = await encryptToken(keyProvider, KEY_REF, "refresh");
  if (!sealedAccess.ok || !sealedRefresh.ok) {
    throw new Error("seed encrypt failed");
  }
  const grant = await createGrantAuth(harness.handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef,
    refreshExpiresAt: new Date(Date.now() + 3_600_000),
  });
  return grant.id;
}

function missingGrantId(): GrantRowId {
  const value = 999_999n;
  if (!isGrantRowId(value)) throw new Error("unbrandable fixture id");
  return value;
}

describe("appGitHubPort — openUrlBoxPullRequestSource", () => {
  it("binds the viewer's decrypted token when the probe succeeds", async () => {
    const grantId = await seedGrant("ghu_viewer");
    vi.mocked(fetchPullRequest).mockImplementation(async (octokit) => {
      expect(tokenOf(octokit)).toBe("ghu_viewer");
      return { ok: true, value: INFO };
    });
    const port = appGitHubPort(unusedApp, {
      handle: harness.handle,
      keyProvider,
      fallbackToken: "ghp_operator",
    });

    const source = await port.openUrlBoxPullRequestSource(
      grantId,
      "acme/widget",
      7,
    );
    // The probe result is served once: the task's first read costs nothing.
    const first = await source.fetchPullRequest();
    expect(first.ok).toBe(true);
    expect(vi.mocked(fetchPullRequest)).toHaveBeenCalledTimes(1);
    // Later reads (the supersession watch) go live again.
    await source.fetchPullRequest();
    expect(vi.mocked(fetchPullRequest)).toHaveBeenCalledTimes(2);
    for (const call of vi.mocked(fetchPullRequest).mock.calls) {
      expect(tokenOf(call[0])).toBe("ghu_viewer");
    }
  });

  it("falls back to the operator PAT after a viewer NOT_FOUND probe", async () => {
    const grantId = await seedGrant("ghu_viewer");
    vi.mocked(fetchPullRequest).mockImplementation(async (octokit) => {
      if (tokenOf(octokit) === "ghu_viewer") {
        return {
          ok: false,
          error: { code: GitHubApiErrorCodes.NOT_FOUND, message: "404" },
        };
      }
      return { ok: true, value: INFO };
    });
    const port = appGitHubPort(unusedApp, {
      handle: harness.handle,
      keyProvider,
      fallbackToken: "ghp_operator",
    });

    const source = await port.openUrlBoxPullRequestSource(
      grantId,
      "acme/widget",
      7,
    );
    const result = await source.fetchPullRequest();
    expect(result.ok).toBe(true);
    const lastCall = vi.mocked(fetchPullRequest).mock.calls.at(-1);
    expect(tokenOf(lastCall?.[0])).toBe("ghp_operator");
  });

  it("falls back to the operator PAT after a viewer FORBIDDEN probe", async () => {
    const grantId = await seedGrant("ghu_viewer");
    vi.mocked(fetchPullRequest).mockImplementation(async (octokit) => {
      if (tokenOf(octokit) === "ghu_viewer") {
        return {
          ok: false,
          error: { code: GitHubApiErrorCodes.FORBIDDEN, message: "403" },
        };
      }
      return { ok: true, value: INFO };
    });
    const port = appGitHubPort(unusedApp, {
      handle: harness.handle,
      keyProvider,
      fallbackToken: "ghp_operator",
    });

    const source = await port.openUrlBoxPullRequestSource(
      grantId,
      "acme/widget",
      7,
    );
    const result = await source.fetchPullRequest();
    expect(result.ok).toBe(true);
    expect(tokenOf(vi.mocked(fetchPullRequest).mock.calls.at(-1)?.[0])).toBe(
      "ghp_operator",
    );
  });

  it("an UNAUTHORIZED probe keeps the viewer binding — a dead token must never escalate to the PAT", async () => {
    const grantId = await seedGrant("ghu_viewer");
    vi.mocked(fetchPullRequest).mockResolvedValue({
      ok: false,
      error: { code: GitHubApiErrorCodes.UNAUTHORIZED, message: "401" },
    });
    const port = appGitHubPort(unusedApp, {
      handle: harness.handle,
      keyProvider,
      fallbackToken: "ghp_operator",
    });

    const source = await port.openUrlBoxPullRequestSource(
      grantId,
      "acme/widget",
      7,
    );
    const result = await source.fetchPullRequest();
    expect(result.ok).toBe(false);
    for (const call of vi.mocked(fetchPullRequest).mock.calls) {
      expect(tokenOf(call[0])).toBe("ghu_viewer");
    }
  });

  it("keeps the viewer binding on a denial when no PAT is configured", async () => {
    const grantId = await seedGrant("ghu_viewer");
    vi.mocked(fetchPullRequest).mockResolvedValue({
      ok: false,
      error: { code: GitHubApiErrorCodes.NOT_FOUND, message: "404" },
    });
    const port = appGitHubPort(unusedApp, {
      handle: harness.handle,
      keyProvider,
    });

    const source = await port.openUrlBoxPullRequestSource(
      grantId,
      "acme/widget",
      7,
    );
    // No probe happened (nothing to decide); the task's own read surfaces it.
    expect(vi.mocked(fetchPullRequest)).not.toHaveBeenCalled();
    const result = await source.fetchPullRequest();
    expect(result.ok).toBe(false);
  });

  it("a vanished grant is a permanent github-access failure", async () => {
    const port = appGitHubPort(unusedApp, {
      handle: harness.handle,
      keyProvider,
    });
    await expect(
      port.openUrlBoxPullRequestSource(missingGrantId(), "acme/widget", 7),
    ).rejects.toThrow(PermanentJobError);
  });

  it("an unreadable token is a permanent github-access failure", async () => {
    const grantId = await seedGrant("ghu_viewer", "MISSING_KEY_REF");
    const port = appGitHubPort(unusedApp, {
      handle: harness.handle,
      keyProvider,
    });
    await expect(
      port.openUrlBoxPullRequestSource(grantId, "acme/widget", 7),
    ).rejects.toThrow(PermanentJobError);
  });

  it("refuses url-box jobs when no credential path is wired", async () => {
    const port = appGitHubPort(unusedApp);
    await expect(
      port.openUrlBoxPullRequestSource(missingGrantId(), "acme/widget", 7),
    ).rejects.toThrow(PermanentJobError);
  });
});
