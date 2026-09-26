// The per-reviewer archive: one row per (installation, pull request,
// reviewer) anchored on the latest brief's head, verified against the scope
// in the same transaction, and gone with the pull request's cascade.
import { asc } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createArtifactStore,
  createPurgeRoutines,
  createTenantRepository,
  InboxArchiveErrorCodes,
  type AppDatabase,
  type ScopeContext,
} from "../src/index";
import { internal } from "../src/db/handle";
import { inboxArchive } from "../src/schema/inbox-archive";
import {
  isInstallationId,
  isPullRequestRowId,
  isRepoId,
  isReviewerId,
  PrStates,
  type InstallationId,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
} from "../src/types";
import { brandWith, freshDatabase } from "./helpers";

const ACME: InstallationId = brandWith(isInstallationId, 10n);
const OCTO: InstallationId = brandWith(isInstallationId, 20n);
const VIEWER: ReviewerId = brandWith(isReviewerId, 501n);
const OTHER: ReviewerId = brandWith(isReviewerId, 502n);
const REPO: RepoId = brandWith(isRepoId, 100n);
const CTX_ACME: ScopeContext = { installationId: ACME };
const CTX_OCTO: ScopeContext = { installationId: OCTO };
const CTX_VIEWER: ScopeContext = { ownerUserId: VIEWER };
const CTX_OTHER: ScopeContext = { ownerUserId: OTHER };

async function seedRow(
  handle: AppDatabase,
  ctx: ScopeContext,
  prNumber = 1,
): Promise<PullRequestRowId> {
  const row = await createTenantRepository(handle, ctx).pullRequests.upsert({
    repoId: REPO,
    prNumber,
    repoSlug: "org/repo",
    state: PrStates.OPEN,
  });
  return brandWith(isPullRequestRowId, row.id);
}

async function seedBrief(
  handle: AppDatabase,
  ctx: ScopeContext,
  pullRequestId: PullRequestRowId,
  headSha: string,
): Promise<void> {
  const store = createArtifactStore(handle, ctx);
  const prior = await store.briefs.listForPullRequest(pullRequestId);
  const headIndex = (prior.at(-1)?.headIndex ?? 0) + 1;
  const written = await store.briefs.write({
    pullRequestId,
    baseSha: "base",
    headSha,
    headIndex,
    commitCount: 1,
    provider: "stub",
    model: "stub",
    effort: "low",
    body: "{}",
  });
  if (!written.ok) {
    throw new Error(written.error.message);
  }
}

interface ArchiveRow {
  readonly installation_id: bigint | null;
  readonly pull_request_id: bigint;
  readonly reviewer_id: bigint;
  readonly head_sha: string | null;
}

async function readArchives(handle: AppDatabase): Promise<ArchiveRow[]> {
  const rows = await internal(handle)
    .select({
      installation_id: inboxArchive.installationId,
      pull_request_id: inboxArchive.pullRequestId,
      reviewer_id: inboxArchive.reviewerId,
      head_sha: inboxArchive.headSha,
    })
    .from(inboxArchive)
    .orderBy(asc(inboxArchive.id));
  return rows;
}

describe("the inbox archive store", () => {
  it("archives one row per reviewer anchored on the latest brief's head", async () => {
    const handle = await freshDatabase();
    const prId = await seedRow(handle, CTX_ACME);
    await seedBrief(handle, CTX_ACME, prId, "old-head");
    await seedBrief(handle, CTX_ACME, prId, "new-head");

    const set = await createTenantRepository(handle, CTX_ACME).archives.set(
      prId,
      VIEWER,
    );
    expect(set.ok).toBe(true);

    expect(await readArchives(handle)).toEqual([
      {
        installation_id: ACME,
        pull_request_id: prId,
        reviewer_id: VIEWER,
        head_sha: "new-head",
      },
    ]);
  });

  it("archiving again moves the anchor instead of adding a row", async () => {
    const handle = await freshDatabase();
    const prId = await seedRow(handle, CTX_ACME);
    const archives = createTenantRepository(handle, CTX_ACME).archives;

    await archives.set(prId, VIEWER);
    await seedBrief(handle, CTX_ACME, prId, "later-head");
    await archives.set(prId, VIEWER);

    const rows = await readArchives(handle);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.head_sha).toBe("later-head");
  });

  it("a pull request with no brief yet archives with no anchor", async () => {
    const handle = await freshDatabase();
    const prId = await seedRow(handle, CTX_ACME);

    await createTenantRepository(handle, CTX_ACME).archives.set(prId, VIEWER);

    expect((await readArchives(handle))[0]?.head_sha).toBeNull();
  });

  it("two reviewers archive the same row separately", async () => {
    const handle = await freshDatabase();
    const prId = await seedRow(handle, CTX_ACME);
    const archives = createTenantRepository(handle, CTX_ACME).archives;

    await archives.set(prId, VIEWER);
    await archives.set(prId, OTHER);
    await archives.clear(prId, VIEWER);

    expect((await readArchives(handle)).map((row) => row.reviewer_id)).toEqual([
      OTHER,
    ]);
  });

  it("clear removes the reviewer's row and is a no-op when none exists", async () => {
    const handle = await freshDatabase();
    const prId = await seedRow(handle, CTX_ACME);
    const archives = createTenantRepository(handle, CTX_ACME).archives;

    await archives.set(prId, VIEWER);
    const first = await archives.clear(prId, VIEWER);
    const again = await archives.clear(prId, VIEWER);

    expect(first.ok && again.ok).toBe(true);
    expect(await readArchives(handle)).toEqual([]);
  });

  it("refuses a pull request outside the scope and writes nothing", async () => {
    const handle = await freshDatabase();
    const prId = await seedRow(handle, CTX_ACME);

    const set = await createTenantRepository(handle, CTX_OCTO).archives.set(
      prId,
      VIEWER,
    );
    const cleared = await createTenantRepository(
      handle,
      CTX_OCTO,
    ).archives.clear(prId, VIEWER);

    expect(!set.ok && set.error.code).toBe(InboxArchiveErrorCodes.NOT_FOUND);
    expect(!cleared.ok && cleared.error.code).toBe(
      InboxArchiveErrorCodes.NOT_FOUND,
    );
    expect(await readArchives(handle)).toEqual([]);
  });

  it("the owner world isolates by owner", async () => {
    const handle = await freshDatabase();
    const prId = await seedRow(handle, CTX_VIEWER);

    const foreign = await createTenantRepository(
      handle,
      CTX_OTHER,
    ).archives.set(prId, OTHER);
    const own = await createTenantRepository(handle, CTX_VIEWER).archives.set(
      prId,
      VIEWER,
    );

    expect(foreign.ok).toBe(false);
    expect(own.ok).toBe(true);
    expect(await readArchives(handle)).toEqual([
      {
        installation_id: null,
        pull_request_id: prId,
        reviewer_id: VIEWER,
        head_sha: null,
      },
    ]);
  });

  it("the row goes with the pull request's cascade", async () => {
    const handle = await freshDatabase();
    const prId = await seedRow(handle, CTX_ACME);
    await createTenantRepository(handle, CTX_ACME).archives.set(prId, VIEWER);

    await createPurgeRoutines(handle, CTX_ACME).purgePullRequest(prId);

    expect(await readArchives(handle)).toEqual([]);
  });
});
