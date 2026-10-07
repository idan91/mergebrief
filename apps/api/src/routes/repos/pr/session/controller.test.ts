import type { Logger } from "logging";
import {
  createArtifactStore,
  createTenantRepository,
  isInstallationId,
  isRepoId,
  isReviewerId,
  parseTenantContext,
  type RepoId,
  type TenantContext,
} from "persistence";
import { PrStates } from "types/pull-requests";
import { createPgliteHarness, type PgliteHarness } from "persistence/testing";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestUserOctokit } from "../../../../../test/fixtures";
import type { AuthRouteDeps } from "../../../auth/session/types";
import { sessionController } from "./controller";
import { resolveSessionTarget } from "./logic/brief-target";
import { UnreadableBriefError } from "./logic/carry-over-inputs";

vi.mock("persistence", async (importOriginal) => {
  const actual = await importOriginal<{
    createTenantRepository: typeof createTenantRepository;
  }>();
  return {
    ...actual,
    createTenantRepository: vi.fn(actual.createTenantRepository),
  };
});

vi.mock("./logic/brief-target", async (importOriginal) => {
  const actual = await importOriginal<{
    resolveSessionTarget: typeof resolveSessionTarget;
  }>();
  return {
    ...actual,
    resolveSessionTarget: vi.fn(actual.resolveSessionTarget),
  };
});

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
    const written = await resolved.value.run(
      async (writer) => (await writer.draftComments()).length,
    );
    expect(written).toEqual({ ok: true, value: 0 });
  });
});

describe("sessionController.previewSession", () => {
  const span = { base: "base1", head: "head1" };

  async function previewWithUnreadableBrief(stillThere: boolean) {
    const target = await resolveSessionTarget(
      deps,
      ctx,
      repoId,
      PR_NUMBER,
      span,
    );
    if (target === undefined) {
      throw new Error("fixture brief missing");
    }
    vi.mocked(resolveSessionTarget)
      .mockResolvedValueOnce(target)
      .mockResolvedValueOnce(stillThere ? target : undefined);
    vi.mocked(createTenantRepository).mockReturnValueOnce({
      reviewSessions: {
        preview: () =>
          Promise.reject(new UnreadableBriefError("brief row vanished")),
      },
    } as unknown as ReturnType<typeof createTenantRepository>);

    return sessionController.previewSession(deps, {
      ctx,
      repoId,
      prNumber: PR_NUMBER,
      span,
      reviewerId: brand(REVIEWER_ID, isReviewerId),
      log,
    });
  }

  it("answers not found when the brief is purged mid-read", async () => {
    expect(await previewWithUnreadableBrief(false)).toEqual({
      ok: false,
      error: { kind: "target-not-found" },
    });
  });

  it("keeps an unreadable brief that still exists a fault", async () => {
    expect(await previewWithUnreadableBrief(true)).toEqual({
      ok: false,
      error: { kind: "unreadable-brief" },
    });
  });
});
