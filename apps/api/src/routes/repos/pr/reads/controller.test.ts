import {
  createArtifactStore,
  createTenantRepository,
  isInstallationId,
  isRepoId,
  parseTenantContext,
  type RepoId,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Logger } from "logging";
import type { OpenPullRequest } from "brief-core/pr-stack";
import { NotFound } from "../../../../shared-errors/api-error";
import type { ReviewerGitHubClient } from "../../../auth/reviewer-github-client";
import { buildOpenPullsCacheKey } from "../../../open-pulls-cache";
import { createTtlCache } from "../../../ttl-cache";
import { readsController } from "./controller";
import type { ReadsControllerDeps } from "./types";

let harness: PgliteHarness;
let deps: ReadsControllerDeps;
let repoId: RepoId;

const PR_NUMBER = 7;

beforeAll(async () => {
  harness = await createPgliteHarness();
  const installationId = 555n;
  if (!isInstallationId(installationId)) {
    throw new Error("unbrandable installation id");
  }
  const ctx = parseTenantContext({ installationId });
  const rawRepoId = 4321n;
  if (!isRepoId(rawRepoId)) {
    throw new Error("unbrandable repo id");
  }
  repoId = rawRepoId;
  const tenant = createTenantRepository(harness.handle, ctx);
  const artifacts = createArtifactStore(harness.handle, ctx);
  deps = { tenant, artifacts };
  const pr = await tenant.pullRequests.upsert({
    repoId,
    prNumber: PR_NUMBER,
    repoSlug: "acme/app",
    title: "Add thing",
    state: PrStates.OPEN,
  });
  const written = await artifacts.briefs.write({
    pullRequestId: pr.id,
    baseSha: "base1",
    headSha: "head1",
    headIndex: 0,
    commitCount: 1,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    body: '{"stored":"verbatim"}',
  });
  if (!written.ok) {
    throw new Error("fixture brief write failed");
  }
});
afterAll(async () => {
  await harness.close();
});

describe("readsController", () => {
  it("returns a stored brief body verbatim", async () => {
    const body = await readsController.readBrief(deps, {
      repoId,
      prNumber: PR_NUMBER,
      base: "base1",
      head: "head1",
    });
    expect(body).toBe('{"stored":"verbatim"}');
  });

  it("throws NotFound for a span with no stored artifact", async () => {
    await expect(
      readsController.readBrief(deps, {
        repoId,
        prNumber: PR_NUMBER,
        base: "base1",
        head: "other-head",
      }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      readsController.readMarks(deps, {
        repoId,
        prNumber: PR_NUMBER,
        baseline: "base1",
        head: "head1",
      }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("throws NotFound for an unknown PR before touching artifacts", async () => {
    await expect(
      readsController.readDelta(deps, {
        repoId,
        prNumber: 999,
        baseline: "base1",
        head: "head1",
      }),
    ).rejects.toBeInstanceOf(NotFound);
    await expect(
      readsController.readNarrative(deps, {
        repoId,
        prNumber: 999,
        prevHead: "head0",
        head: "head1",
      }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("a failed stack record logs and still answers the resolved stack", async () => {
    const sessionTokenHash = "hash-record-fails";
    const repo = { owner: "acme", repo: "app" };
    const open: OpenPullRequest[] = [
      {
        number: PR_NUMBER,
        title: "Add thing",
        headRef: "feature/mid",
        baseRef: "main",
        headRepo: repo,
        baseRepo: repo,
      },
      {
        number: 8,
        title: "PR 8",
        headRef: "feature/tip",
        baseRef: "feature/mid",
        headRepo: repo,
        baseRepo: repo,
      },
    ];
    const openPullsCache = createTtlCache<readonly OpenPullRequest[]>(4);
    openPullsCache.set(
      buildOpenPullsCacheKey({ sessionTokenHash, repoId }),
      open,
      Date.now() + 60_000,
      Date.now(),
    );
    const github: ReviewerGitHubClient = {
      run: () => {
        throw new Error("no GitHub call expected");
      },
      runRead: () => {
        throw new Error("no GitHub call expected");
      },
      createOctokit: () => {
        throw new Error("no GitHub call expected");
      },
      createMutationOctokit: () => {
        throw new Error("no GitHub call expected");
      },
      session: () => {
        throw new Error("no session expected");
      },
    };
    const warn = vi.fn();
    const log: Logger = {
      error: vi.fn(),
      warn,
      info: vi.fn(),
      debug: vi.fn(),
      child: () => log,
    };
    const tenant = {
      ...deps.tenant,
      pullRequests: {
        ...deps.tenant.pullRequests,
        recordStack: async () => ({
          ok: false as const,
          error: { code: "not-found" as const, message: "gone" },
        }),
      },
    };

    const result = await readsController.readStack(
      { ...deps, tenant, github, openPullsCache, log },
      {
        repoId,
        prNumber: PR_NUMBER,
        owner: "acme",
        repo: "app",
        sessionTokenHash,
      },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected success");
    expect(result.value).toEqual({
      stack: {
        members: [
          { number: PR_NUMBER, title: "Add thing" },
          { number: 8, title: "PR 8" },
        ],
        index: 1,
      },
    });
    expect(warn).toHaveBeenCalledWith("stack record failed", {
      code: "not-found",
      pullRequestId: expect.any(String),
    });
  });
});
