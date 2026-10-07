import type { Logger } from "logging";
import {
  createArtifactStore,
  createTenantRepository,
  isInstallationId,
  isRepoId,
  isReviewerId,
  parseTenantContext,
  ReviewSessionErrorCodes,
  type RepoId,
  type TenantContext,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { ReviewOutcomes } from "types/reviews";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestUserOctokit } from "../../../../../test/fixtures";
import { FailureKinds } from "../../../../shared-errors/failures";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { sessionController } from "./controller";

const log: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => log,
};

function brand<T extends bigint>(
  value: bigint,
  guard: (v: bigint) => v is T,
): T {
  if (!guard(value)) {
    throw new Error("unbrandable fixture value");
  }
  return value;
}

let harness: PgliteHarness;
let deps: AuthRouteDeps;
let ctx: TenantContext;
let repoId: RepoId;
const PR_NUMBER = 7;
const REVIEWER_ID = 42n;

const BRIEF_BODY = JSON.stringify({
  changeGroups: [{ id: "g1" }],
  chunks: [],
});

beforeAll(async () => {
  harness = await createPgliteHarness();
  ctx = parseTenantContext({
    installationId: brand(808n, isInstallationId),
  });
  repoId = brand(9911n, isRepoId);
  deps = {
    handle: harness.handle,
    auth: {
      oauthClientId: "client-id",
      oauthClientSecret: "client-secret",
      keyProvider: {
        resolveKey: () => ({
          ok: false,
          error: { code: "missing", message: "unused" },
        }),
      },
      sessionKeyRef: "UNUSED",
      publicBaseUrl: "https://example.test",
      createUserOctokit: createTestUserOctokit,
    },
  };
  const tenant = createTenantRepository(harness.handle, ctx);
  const pr = await tenant.pullRequests.upsert({
    repoId,
    prNumber: PR_NUMBER,
    repoSlug: "acme/app",
    title: "Add thing",
    state: PrStates.OPEN,
  });
  const written = await createArtifactStore(harness.handle, ctx).briefs.write({
    pullRequestId: pr.id,
    baseSha: "base1",
    headSha: "head1",
    headIndex: 0,
    commitCount: 1,
    provider: "anthropic",
    model: "claude",
    effort: "high",
    body: BRIEF_BODY,
  });
  if (!written.ok) {
    throw new Error("fixture brief write failed");
  }
});
afterAll(async () => {
  await harness.close();
});

describe("sessionController.resolveWrite", () => {
  it("refuses a span that names no stored Brief", async () => {
    const resolved = await sessionController.resolveWrite(deps, {
      ctx,
      repoId,
      prNumber: PR_NUMBER,
      span: { base: "base1", head: "unknown-head" },
      reviewerId: brand(REVIEWER_ID, isReviewerId),
      log,
    });
    expect(resolved).toEqual({
      ok: false,
      error: { kind: "target-not-found" },
    });
  });

  it("binds a write to the named Brief and runs it", async () => {
    const resolved = await sessionController.resolveWrite(deps, {
      ctx,
      repoId,
      prNumber: PR_NUMBER,
      span: { base: "base1", head: "head1" },
      reviewerId: brand(REVIEWER_ID, isReviewerId),
      log,
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) {
      throw new Error("unreachable");
    }
    expect(resolved.value.head).toBe("head1");
    const listed = await resolved.value.publish.readDrafts();
    expect(listed).toEqual({ ok: true, value: [] });
  });
});

describe("sessionController.previewSession", () => {
  const UNREADABLE_PR = 8;

  async function seedUnreadableNextBrief(): Promise<void> {
    const tenant = createTenantRepository(harness.handle, ctx);
    const pr = await tenant.pullRequests.upsert({
      repoId,
      prNumber: UNREADABLE_PR,
      repoSlug: "acme/app",
      title: "Change thing",
      state: PrStates.OPEN,
    });
    const briefs = createArtifactStore(harness.handle, ctx).briefs;
    const seeds = [
      { headSha: "head1", headIndex: 0, body: BRIEF_BODY },
      { headSha: "head2", headIndex: 1, body: "{ not json" },
    ];
    for (const seed of seeds) {
      const written = await briefs.write({
        ...seed,
        pullRequestId: pr.id,
        baseSha: "base1",
        commitCount: 1,
        provider: "anthropic",
        model: "claude",
        effort: "high",
      });
      if (!written.ok) {
        throw new Error("fixture brief write failed");
      }
    }
  }

  function makeInput(head: string) {
    return {
      ctx,
      repoId,
      prNumber: UNREADABLE_PR,
      span: { base: "base1", head },
      reviewerId: brand(REVIEWER_ID, isReviewerId),
      log,
    };
  }

  it("refuses a carry-over over an unreadable brief with the store code", async () => {
    await seedUnreadableNextBrief();
    const earlier = await sessionController.resolveWrite(
      deps,
      makeInput("head1"),
    );
    if (!earlier.ok) {
      throw new Error("fixture brief missing");
    }
    await earlier.value.work.setOutcome(ReviewOutcomes.COMMENT);

    const previewed = await sessionController.previewSession(
      deps,
      makeInput("head2"),
    );

    expect(previewed).toEqual({
      ok: false,
      error: {
        kind: FailureKinds.SESSION_REJECTED,
        error: expect.objectContaining({
          code: ReviewSessionErrorCodes.BRIEF_UNREADABLE,
        }),
      },
    });
    expect(log.error).toHaveBeenCalled();
  });
});
