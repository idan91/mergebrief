// The e2e database seed, run by the global setup (via tsx) after postgres is
// up and before the servers boot: migrate, ingest the committed fixture
// artifacts under the owner world, and create the browser session. The
// `graphile_worker` schema is not this script's to install: the API installs
// it at boot, which happens before any test can enqueue.
import { createHash } from "node:crypto";
import { STORED_BODY_VERSION } from "brief-core/artifact";
import { ingestBriefDirectory } from "ingest-briefs";
import {
  closeDb,
  createArtifactStore,
  createDb,
  createSessionAuth,
  createTenantRepository,
  createEnvKeyProvider,
  ensureAppSchema,
  isBriefRowId,
  isInstallationId,
  isPullRequestRowId,
  isRepoId,
  isReviewerId,
  type AppDatabase,
  type BriefRowId,
  type PullRequestLifecycle,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
  type ScopeContext,
} from "persistence";
import { seedGrant } from "persistence/testing";
import { PrStates } from "types/pull-requests";
import {
  E2E_OTHER_LOGIN,
  E2E_VIEWER_LOGIN,
  INBOX_BEHIND_ROW,
  INBOX_INSTALLATIONS,
  INBOX_ROWS,
  InboxSeedStates,
  type InboxFixtureRow,
} from "../fixtures/inbox";
import {
  E2E_DATABASE_URL,
  E2E_HIDDEN_INSTALLATION,
  E2E_OWNER_USER_ID,
  E2E_REPO_ID,
  E2E_REPO_SLUG,
  E2E_SESSION_COOKIE,
  E2E_SEED_LATEST_HEAD,
  E2E_SEED_OLDER_HEAD,
  E2E_SESSION_KEY,
  E2E_STATE_VIEWERS,
  FIXTURE_DIR,
  type StateViewer,
} from "./env";
import { buildSeedBrief, SEED_ORIGIN } from "./seed-brief";

const MINUTE_MS = 60_000;
const SEED_BASE_SHA = "0000000099998888777766665555444433332222";
const SEED_COMMIT_COUNT = 1;

interface SeedPullRequest {
  readonly id: PullRequestRowId;
  readonly repoSlug: string;
  readonly prNumber: number;
  readonly title: string;
}

function brandRepo(value: number): RepoId {
  const asBigInt = BigInt(value);
  if (!isRepoId(asBigInt)) {
    throw new Error("bad repo id");
  }
  return asBigInt;
}

function resolveInstallationContext(installationId: number): ScopeContext {
  const asBigInt = BigInt(installationId);
  if (!isInstallationId(asBigInt)) {
    throw new Error("bad installation id");
  }
  return { installationId: asBigInt };
}

async function writeBrief(
  handle: AppDatabase,
  ctx: ScopeContext,
  pullRequest: SeedPullRequest,
  headSha: string,
  headIndex: number,
): Promise<BriefRowId> {
  const body = buildSeedBrief({
    repoSlug: pullRequest.repoSlug,
    prNumber: pullRequest.prNumber,
    title: pullRequest.title,
    baseSha: SEED_BASE_SHA,
    headSha,
    headIndex,
    commitCount: SEED_COMMIT_COUNT,
  });
  const written = await createArtifactStore(handle, ctx).briefs.write({
    ...SEED_ORIGIN,
    pullRequestId: pullRequest.id,
    baseSha: SEED_BASE_SHA,
    headSha,
    headIndex,
    commitCount: SEED_COMMIT_COUNT,
    body: JSON.stringify(body),
    bodyVersion: STORED_BODY_VERSION,
    usedGroupIds: body.changeGroups.map((group) => group.id),
  });
  if (!isBriefRowId(written.id)) {
    throw new Error("bad brief id");
  }
  return written.id;
}

async function openSession(
  handle: AppDatabase,
  ctx: ScopeContext,
  briefId: BriefRowId,
  reviewerId: ReviewerId,
  submit: boolean,
): Promise<void> {
  const published = submit
    ? { draftIds: [], githubReviewId: 77n }
    : { draftIds: [] };
  const result = await createTenantRepository(
    handle,
    ctx,
  ).reviewSessions.recordPublishedDrafts({ briefId, reviewerId }, published);
  if (!result.ok) {
    throw new Error(`session seed failed: ${result.error.code}`);
  }
}

/**
 * One installation row per fixture state. The review state comes from the
 * viewer's session on the latest brief and from a submitted review on it or
 * on an older brief, exactly as the Inbox query derives it.
 */
async function seedInboxRow(
  handle: AppDatabase,
  viewer: ReviewerId,
  row: InboxFixtureRow,
  seededAt: Date,
): Promise<void> {
  const ctx = resolveInstallationContext(row.installationId);
  const installation = INBOX_INSTALLATIONS.find(
    (candidate) => candidate.id === row.installationId,
  );
  const repo = installation?.repos.find(
    (candidate) => candidate.id === row.repoId,
  );
  if (repo === undefined) {
    throw new Error("fixture row names an unknown repo");
  }
  const updatedAt = new Date(
    seededAt.getTime() - row.updatedMinutesAgo * MINUTE_MS,
  );
  const lifecycle: PullRequestLifecycle = { state: PrStates.OPEN };
  const written = await createTenantRepository(handle, ctx).pullRequests.upsert(
    {
      repoId: brandRepo(row.repoId),
      prNumber: row.prNumber,
      repoSlug: repo.slug,
      title: row.title,
      authorLogin:
        row.state === InboxSeedStates.YOURS
          ? E2E_VIEWER_LOGIN
          : E2E_OTHER_LOGIN,
      draft: row.draft ?? false,
      githubUpdatedAt: updatedAt,
      ...lifecycle,
    },
  );
  if (!isPullRequestRowId(written.id)) {
    throw new Error("bad pull request id");
  }
  const pullRequest: SeedPullRequest = {
    id: written.id,
    repoSlug: repo.slug,
    prNumber: row.prNumber,
    title: row.title,
  };

  if (row.state === InboxSeedStates.UPDATED) {
    const older = await writeBrief(
      handle,
      ctx,
      pullRequest,
      E2E_SEED_OLDER_HEAD,
      1,
    );
    await openSession(handle, ctx, older, viewer, true);
    await writeBrief(handle, ctx, pullRequest, E2E_SEED_LATEST_HEAD, 2);
    return;
  }
  const latest = await writeBrief(
    handle,
    ctx,
    pullRequest,
    E2E_SEED_LATEST_HEAD,
    1,
  );
  if (row.state === InboxSeedStates.IN_PROGRESS) {
    await openSession(handle, ctx, latest, viewer, false);
  }
  if (row.state === InboxSeedStates.REVIEWED) {
    await openSession(handle, ctx, latest, viewer, true);
  }
}

/** A second URL row with a brief at an older head; the stub's live read reports a newer one. */
async function seedBehindRow(
  handle: AppDatabase,
  owner: ReviewerId,
  repoId: RepoId,
): Promise<void> {
  const ctx: ScopeContext = { ownerUserId: owner };
  const written = await createTenantRepository(handle, ctx).pullRequests.upsert(
    {
      repoId,
      prNumber: INBOX_BEHIND_ROW.prNumber,
      repoSlug: E2E_REPO_SLUG,
      title: INBOX_BEHIND_ROW.title,
      authorLogin: E2E_OTHER_LOGIN,
      state: PrStates.OPEN,
    },
  );
  if (!isPullRequestRowId(written.id)) {
    throw new Error("bad pull request id");
  }
  const pullRequest: SeedPullRequest = {
    id: written.id,
    repoSlug: E2E_REPO_SLUG,
    prNumber: INBOX_BEHIND_ROW.prNumber,
    title: INBOX_BEHIND_ROW.title,
  };
  await writeBrief(handle, ctx, pullRequest, INBOX_BEHIND_ROW.briefHead, 1);
}

/** The hidden-state viewer's one row: merged, so the default status filter shows nothing. */
async function seedMergedRow(
  handle: AppDatabase,
  seededAt: Date,
): Promise<void> {
  const ctx = resolveInstallationContext(E2E_HIDDEN_INSTALLATION.id);
  const [repo] = E2E_HIDDEN_INSTALLATION.repos;
  const written = await createTenantRepository(handle, ctx).pullRequests.upsert(
    {
      repoId: brandRepo(repo.id),
      prNumber: 1,
      repoSlug: repo.slug,
      title: "Merged before you looked",
      authorLogin: "mira-k",
      draft: false,
      githubUpdatedAt: seededAt,
      state: PrStates.MERGED,
      closedAt: seededAt,
    },
  );
  if (!isPullRequestRowId(written.id)) {
    throw new Error("bad pull request id");
  }
}

function brandReviewer(value: bigint): ReviewerId {
  if (!isReviewerId(value)) {
    throw new Error("bad owner id");
  }
  return value;
}

/** A grant sealing the viewer's tokens plus the session row the cookie names. */
async function seedSession(
  handle: AppDatabase,
  viewer: StateViewer,
): Promise<void> {
  const keyProvider = createEnvKeyProvider({ SESSION_KEY_V1: E2E_SESSION_KEY });
  const reviewer = brandReviewer(viewer.userId);
  const grant = await seedGrant(handle, {
    userId: reviewer,
    accessToken: viewer.token,
    refreshToken: `ghr_${viewer.login}_refresh`,
    keyProvider,
    keyRef: "SESSION_KEY_V1",
    refreshExpiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
  });
  const sessionTokenHash = createHash("sha256")
    .update(viewer.cookie)
    .digest("hex");
  const sessionExpiresAt = new Date(Date.now() + 7 * 24 * 3_600_000);
  await createSessionAuth(handle).createSession({
    sessionTokenHash,
    reviewerId: reviewer,
    reviewerLogin: viewer.login,
    grantId: grant.id,
    expiresAt: sessionExpiresAt,
  });
}

async function main(): Promise<void> {
  const ensured = await ensureAppSchema(E2E_DATABASE_URL, {
    autoMigrate: true,
  });
  if (!ensured.ok) {
    throw new Error(`migrate failed: ${ensured.error.message}`);
  }

  const handle = createDb(E2E_DATABASE_URL);
  try {
    const owner = brandReviewer(E2E_OWNER_USER_ID);
    const repoId = BigInt(E2E_REPO_ID);
    if (!isRepoId(repoId)) {
      throw new Error("bad repo id");
    }
    const summary = await ingestBriefDirectory(handle, {
      dir: FIXTURE_DIR,
      ctx: { ownerUserId: owner },
      resolveRepo: async () => ({
        repoId,
        lifecycle: { state: PrStates.OPEN },
      }),
    });
    if (summary.briefs === 0) {
      throw new Error("seed ingested no briefs — fixture dir wrong?");
    }
    const seededAt = new Date();
    for (const row of INBOX_ROWS) {
      await seedInboxRow(handle, owner, row, seededAt);
    }
    await seedBehindRow(handle, owner, repoId);
    await seedMergedRow(handle, seededAt);

    // The browser sessions: the owner-world one whose cookie the storage
    // state carries, then one per Home state the seeded rows cannot show.
    await seedSession(handle, {
      userId: E2E_OWNER_USER_ID,
      login: E2E_VIEWER_LOGIN,
      cookie: E2E_SESSION_COOKIE,
      token: "ghu_e2e_access_token",
    });
    for (const viewer of Object.values(E2E_STATE_VIEWERS)) {
      await seedSession(handle, viewer);
    }
    process.stdout.write(
      `seeded: ${String(summary.briefs)} briefs, ${String(summary.narratives)} narratives, ${String(summary.marks)} marks\n`,
    );
  } finally {
    await closeDb(handle);
  }
}

main().catch((error: unknown) => {
  process.stderr.write(
    `e2e seed failed: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exit(1);
});
