// The e2e database seed, run by the global setup (via tsx) after postgres is
// up and before the servers boot: migrate, ingest the committed fixture
// artifacts under the owner world, and create the browser session. The
// `graphile_worker` schema is not this script's to install: the API installs
// it at boot, which happens before any test can enqueue.
import { createHash } from "node:crypto";
import { ingestBriefDirectory } from "ingest-briefs";
import {
  closeDb,
  createArtifactStore,
  createDb,
  createGrantAuth,
  createTenantRepository,
  encryptToken,
  createEnvKeyProvider,
  ensureAppSchema,
  isBriefRowId,
  isInstallationId,
  isPullRequestRowId,
  isRepoId,
  isReviewerId,
  PrStates,
  type AppDatabase,
  type BriefRowId,
  type PullRequestLifecycle,
  type PullRequestRowId,
  type RepoId,
  type ReviewerId,
  type ScopeContext,
} from "persistence";
import {
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
  E2E_SESSION_KEY,
  E2E_STATE_VIEWERS,
  FIXTURE_DIR,
  type StateViewer,
} from "./env";

const MINUTE_MS = 60_000;
const NO_FACTS = { groupIds: [], flags: [], filePaths: [] };
const OLDER_HEAD = "3333333300001111222233334444555566667777";
const LATEST_HEAD = "4444444400001111222233334444555566667777";
const SEED_ORIGIN = { provider: "stub", model: "stub", effort: "low" };

function brandRepo(value: number): RepoId {
  const asBigInt = BigInt(value);
  if (!isRepoId(asBigInt)) throw new Error("bad repo id");
  return asBigInt;
}

function resolveInstallationContext(installationId: number): ScopeContext {
  const asBigInt = BigInt(installationId);
  if (!isInstallationId(asBigInt)) throw new Error("bad installation id");
  return { installationId: asBigInt };
}

async function writeBrief(
  handle: AppDatabase,
  ctx: ScopeContext,
  pullRequestId: PullRequestRowId,
  headSha: string,
  headIndex: number,
): Promise<BriefRowId> {
  const written = await createArtifactStore(handle, ctx).briefs.write({
    ...SEED_ORIGIN,
    pullRequestId,
    baseSha: "0000000099998888777766665555444433332222",
    headSha,
    headIndex,
    commitCount: 1,
    body: "{}",
  });
  if (!written.ok)
    throw new Error(`brief seed failed: ${written.error.message}`);
  if (!isBriefRowId(written.value.id)) throw new Error("bad brief id");
  return written.value.id;
}

async function openSession(
  handle: AppDatabase,
  ctx: ScopeContext,
  briefId: BriefRowId,
  reviewerId: ReviewerId,
  submit: boolean,
): Promise<void> {
  const result = await createTenantRepository(
    handle,
    ctx,
  ).reviewSessions.writeToSession(
    { briefId, reviewerId, brief: async () => NO_FACTS },
    async (writer) => {
      if (submit) await writer.recordSubmittedReview({ githubReviewId: 77n });
      return undefined;
    },
  );
  if (!result.ok) throw new Error(`session seed failed: ${result.error.code}`);
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
  if (repo === undefined) throw new Error("fixture row names an unknown repo");
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
        row.state === InboxSeedStates.YOURS ? E2E_VIEWER_LOGIN : "mira-k",
      draft: row.draft ?? false,
      githubUpdatedAt: updatedAt,
      ...lifecycle,
    },
  );
  if (!isPullRequestRowId(written.id)) throw new Error("bad pull request id");
  const pullRequestId = written.id;

  if (row.state === InboxSeedStates.UPDATED) {
    const older = await writeBrief(handle, ctx, pullRequestId, OLDER_HEAD, 1);
    await openSession(handle, ctx, older, viewer, true);
    await writeBrief(handle, ctx, pullRequestId, LATEST_HEAD, 2);
    return;
  }
  const latest = await writeBrief(handle, ctx, pullRequestId, LATEST_HEAD, 1);
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
      authorLogin: "mira-k",
      state: PrStates.OPEN,
    },
  );
  if (!isPullRequestRowId(written.id)) throw new Error("bad pull request id");
  await writeBrief(handle, ctx, written.id, INBOX_BEHIND_ROW.briefHead, 1);
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
      purgeAfter: null,
    },
  );
  if (!isPullRequestRowId(written.id)) throw new Error("bad pull request id");
}

function brandReviewer(value: bigint): ReviewerId {
  if (!isReviewerId(value)) throw new Error("bad owner id");
  return value;
}

/** A grant sealing the viewer's tokens plus the session row the cookie names. */
async function seedSession(
  handle: AppDatabase,
  viewer: StateViewer,
): Promise<void> {
  const keyProvider = createEnvKeyProvider({ SESSION_KEY_V1: E2E_SESSION_KEY });
  const sealedAccess = await encryptToken(
    keyProvider,
    "SESSION_KEY_V1",
    viewer.token,
  );
  const sealedRefresh = await encryptToken(
    keyProvider,
    "SESSION_KEY_V1",
    `ghr_${viewer.login}_refresh`,
  );
  if (!sealedAccess.ok || !sealedRefresh.ok) {
    throw new Error("seed encrypt failed");
  }
  const reviewer = brandReviewer(viewer.userId);
  const grant = await createGrantAuth(handle).createGrant({
    ghTokenCiphertext: sealedAccess.value,
    ghRefreshTokenCiphertext: sealedRefresh.value,
    keyRef: "SESSION_KEY_V1",
    refreshExpiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
  });
  await createTenantRepository(handle, {
    ownerUserId: reviewer,
  }).sessions.create({
    sessionTokenHash: createHash("sha256").update(viewer.cookie).digest("hex"),
    reviewerId: reviewer,
    reviewerLogin: viewer.login,
    grantId: grant.id,
    expiresAt: new Date(Date.now() + 7 * 24 * 3_600_000),
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
    if (!isRepoId(repoId)) throw new Error("bad repo id");
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
