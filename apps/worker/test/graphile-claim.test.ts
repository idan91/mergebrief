// Real graphile over a real Postgres: the job persistence enqueues is claimed
// through the worker's own task list, and its payload passes the worker's
// parser. The stubbed jobs table cannot prove either. Runs only against
// MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset, red under CI.
import { randomInt } from "node:crypto";
import {
  Logger as GraphileLogger,
  makeWorkerUtils,
  runMigrations,
  runOnce,
  type Task,
  type TaskList,
  type WorkerUtils,
} from "graphile-worker";
import {
  closeDb,
  createDb,
  createGenerationProjection,
  createIngestRoutines,
  createTenantRepository,
  ensureAppSchema,
  GenerationKinds,
  isOwnerContext,
  parseTenantContext,
  TriggerOnDemandOutcomes,
  type PullRequestRowId,
  type TenantContext,
} from "persistence";
import { createBuiltInContextProviders } from "brief-core";
import { DEFAULT_LINK_FETCH } from "generators";
import { createI18n } from "i18n";
import type { FakeGitHub } from "github/testing";
import { startTestTracing } from "logging/testing";
import { readTestPostgresUrl } from "persistence/testing";
import { GenerationFailureCodes, PrStates } from "types";
import { describe, expect, it } from "vitest";
import { buildEntryCommentGeneratingBody } from "../src/task/entry-comment";
import { createSyncEntryTask } from "../src/task/generate";
import { createGitHubPort } from "../src/task/github-port";
import { parseGeneratePayload } from "../src/task/payload";
import { buildTaskList } from "../src/task-list";
import {
  HEAD_1,
  interceptInstallationRepo,
  makeEntryLink,
  makeGitHub,
  makeRepoId,
  PUBLIC_URL,
  readLiveBodies,
  REPO,
  stubGenerator,
} from "./generate/helpers";

const databaseUrl = readTestPostgresUrl(process.env);
/** Far above any real installation id, so the fixture never meets one. */
const SMALLEST_FIXTURE_ID = 1_000_000_000_000;
const FIXTURE_ID_SPAN = 2 ** 40;
const SILENT_GRAPHILE_LOGGER = new GraphileLogger(() => () => undefined);

function failUnexpectedTask(): never {
  throw new Error("claimed a job this test never enqueued");
}

function buildRecordingTaskList(generate: Task): TaskList {
  return buildTaskList({
    generate,
    recoverGeneration: failUnexpectedTask,
    syncEntry: failUnexpectedTask,
    sweepAudit: failUnexpectedTask,
    sweepSessions: failUnexpectedTask,
    sweepPullRequests: failUnexpectedTask,
    sweepWebhookDeliveries: failUnexpectedTask,
    sweepGenerationParts: failUnexpectedTask,
    reconcileWebhookDeliveries: failUnexpectedTask,
  });
}

async function prepareQueue(url: string): Promise<void> {
  const ensured = await ensureAppSchema(url, { autoMigrate: true });
  if (!ensured.ok) {
    throw new Error(ensured.error.message);
  }
  await runMigrations({
    connectionString: url,
    logger: SILENT_GRAPHILE_LOGGER,
  });
}

/** Sets columns on the PR's generate job, through graphile's private table. */
async function updateGenerateJob(
  utils: WorkerUtils,
  pullRequestId: PullRequestRowId,
  set: string,
): Promise<void> {
  const params = [String(pullRequestId)];
  await utils.withPgClient((client) =>
    client.query(
      `update graphile_worker._private_jobs set ${set} where id in (select id from graphile_worker.jobs where task_identifier = 'generate' and payload->>'pull_request_id' = $1)`,
      params,
    ),
  );
}

/** The PR's sync job for the head, as graphile's view shows it; `undefined` when none holds the key. */
async function readSyncJob(
  utils: WorkerUtils,
  pullRequestId: PullRequestRowId,
): Promise<Record<string, unknown> | undefined> {
  const params = [`sync-entry:${String(pullRequestId)}:${HEAD_1}`];
  const read = await utils.withPgClient((client) =>
    client.query<Record<string, unknown>>(
      "select locked_at, attempts, max_attempts from graphile_worker.jobs where key = $1",
      params,
    ),
  );
  return read.rows[0];
}

/** Moves the head's sync job to now, through graphile's private table. */
async function startSyncJobNow(
  utils: WorkerUtils,
  pullRequestId: PullRequestRowId,
): Promise<void> {
  const params = [`sync-entry:${String(pullRequestId)}:${HEAD_1}`];
  await utils.withPgClient((client) =>
    client.query(
      "update graphile_worker._private_jobs set run_at = now() where key = $1",
      params,
    ),
  );
}

const STALE_WINNER_ID = 9_301n;

/** Another writer swaps the head's generating body onto the row inside the first Entry post. */
function storeStaleWinnerOnFirstPost(
  github: FakeGitHub,
  repo: ReturnType<typeof createTenantRepository>,
  pullRequestId: PullRequestRowId,
): void {
  let stored = false;
  const winner = buildEntryCommentGeneratingBody(
    createI18n().t,
    makeEntryLink(HEAD_1),
  );
  interceptInstallationRepo(github, (client) => ({
    ...client,
    async postEntryComment(input) {
      const posted = await client.postEntryComment(input);
      if (posted.ok && !stored) {
        stored = true;
        github.addComment(REPO, STALE_WINNER_ID, winner);
        const row = await repo.pullRequests.getById(pullRequestId);
        await repo.pullRequests.swapEntryComment(pullRequestId, {
          seen: row?.entryCommentId ?? null,
          next: STALE_WINNER_ID,
        });
      }
      return posted;
    },
  }));
}

function buildSyncTaskList(
  ctx: TenantContext,
  syncEntry: Task,
  recordSync: () => void,
): TaskList {
  return buildTaskList({
    generate: () => undefined,
    recoverGeneration: failUnexpectedTask,
    syncEntry: async (payload, helpers) => {
      const parsed = parseGeneratePayload(payload);
      const ours =
        parsed.ok &&
        !isOwnerContext(parsed.value.ctx) &&
        parsed.value.ctx.installationId === ctx.installationId;
      if (!ours) {
        failUnexpectedTask();
      }
      recordSync();
      await syncEntry(payload, helpers);
    },
    sweepAudit: failUnexpectedTask,
    sweepSessions: failUnexpectedTask,
    sweepPullRequests: failUnexpectedTask,
    sweepWebhookDeliveries: failUnexpectedTask,
    sweepGenerationParts: failUnexpectedTask,
    reconcileWebhookDeliveries: failUnexpectedTask,
  });
}

function listClaimedPullRequests(claimed: readonly unknown[]): string[] {
  const ids: string[] = [];
  for (const payload of claimed) {
    const parsed = parseGeneratePayload(payload);
    if (parsed.ok) {
      ids.push(String(parsed.value.pullRequestId));
    }
  }
  return ids;
}

describe.skipIf(databaseUrl === undefined)("graphile enqueue to claim", () => {
  it("claims the generate job persistence enqueued and parses its payload", async () => {
    const url = databaseUrl ?? "";
    await prepareQueue(url);
    const handle = createDb(url);
    const installationId = randomInt(
      SMALLEST_FIXTURE_ID,
      SMALLEST_FIXTURE_ID + FIXTURE_ID_SPAN,
    );
    const ctx = parseTenantContext({ installationId });
    const repoId = makeRepoId(BigInt(installationId));

    const claimed: unknown[] = [];
    const recordPayload: Task = (payload) => {
      claimed.push(payload);
    };
    try {
      const triggered = await createIngestRoutines(
        handle,
        ctx,
      ).triggerGeneration({
        pullRequest: {
          repoId,
          prNumber: 7,
          repoSlug: "acme/widget",
          state: PrStates.OPEN,
        },
        headSha: HEAD_1,
        debounceSeconds: 0,
      });
      await runOnce({
        connectionString: url,
        logger: SILENT_GRAPHILE_LOGGER,
        taskList: buildRecordingTaskList(recordPayload),
      });

      // A shared CI database may hold other suites' jobs; this one's is the
      // one carrying its pull request.
      const ours = claimed
        .map((payload) => parseGeneratePayload(payload))
        .filter(
          (parsed) =>
            parsed.ok &&
            parsed.value.pullRequestId === triggered.pullRequest.id,
        );
      expect(triggered.queued).toBe(true);
      expect(ours).toHaveLength(1);
      expect(ours[0]).toMatchObject({
        ok: true,
        value: { headSha: HEAD_1, ctx: { installationId: ctx.installationId } },
      });
    } finally {
      await closeDb(handle);
    }
  });

  it("links the claimed job's span to the enqueue's trace", async () => {
    const url = databaseUrl ?? "";
    await prepareQueue(url);
    const handle = createDb(url);
    const installationId = randomInt(
      SMALLEST_FIXTURE_ID,
      SMALLEST_FIXTURE_ID + FIXTURE_ID_SPAN,
    );
    const ctx = parseTenantContext({ installationId });
    const repoId = makeRepoId(BigInt(installationId));
    const tracing = startTestTracing();

    const claimedIds: string[] = [];
    const recordClaim: Task = (payload) => {
      const parsed = parseGeneratePayload(payload);
      if (parsed.ok) {
        claimedIds.push(String(parsed.value.pullRequestId));
      }
    };
    try {
      let pullRequestId = "";
      const enqueue = await tracing.runInSpan(async () => {
        const triggered = await createIngestRoutines(
          handle,
          ctx,
        ).triggerGeneration({
          pullRequest: {
            repoId,
            prNumber: 8,
            repoSlug: "acme/widget",
            state: PrStates.OPEN,
          },
          headSha: HEAD_1,
          debounceSeconds: 0,
        });
        pullRequestId = String(triggered.pullRequest.id);
      });
      await runOnce({
        connectionString: url,
        logger: SILENT_GRAPHILE_LOGGER,
        taskList: buildRecordingTaskList(recordClaim),
      });

      const spans = tracing.readFinishedSpans();
      const enqueued = spans.filter((span) => span.traceId === enqueue.traceId);
      const trigger = enqueued.find(
        (span) => span.name === "ingest.triggerGeneration",
      );
      const jobs = spans.filter((span) => span.name === "process generate");
      const ours = jobs.filter((span) =>
        span.links.some((link) => link.traceId === enqueue.traceId),
      );
      expect(claimedIds).toContain(pullRequestId);
      expect(ours).toHaveLength(1);
      expect(ours[0]?.links).toEqual([
        { traceId: enqueue.traceId, spanId: trigger?.spanId },
      ]);
    } finally {
      await tracing.stop();
      await closeDb(handle);
    }
  });

  it("revives a spent generate job when its failed head is regenerated", async () => {
    const url = databaseUrl ?? "";
    await prepareQueue(url);
    const handle = createDb(url);
    const utils = await makeWorkerUtils({
      connectionString: url,
      logger: SILENT_GRAPHILE_LOGGER,
    });
    const installationId = randomInt(
      SMALLEST_FIXTURE_ID,
      SMALLEST_FIXTURE_ID + FIXTURE_ID_SPAN,
    );
    const ctx = parseTenantContext({ installationId });
    const repoId = makeRepoId(BigInt(installationId));
    const ingest = createIngestRoutines(handle, ctx);
    const claimed: unknown[] = [];
    const recordPayload: Task = (payload) => {
      claimed.push(payload);
    };
    const drainQueue = () =>
      runOnce({
        connectionString: url,
        logger: SILENT_GRAPHILE_LOGGER,
        taskList: buildRecordingTaskList(recordPayload),
      });
    try {
      const triggered = await ingest.triggerGeneration({
        pullRequest: {
          repoId,
          prNumber: 9,
          repoSlug: "acme/widget",
          state: PrStates.OPEN,
        },
        headSha: HEAD_1,
        debounceSeconds: 0,
      });
      const pullRequestId = triggered.pullRequest.id;
      await updateGenerateJob(
        utils,
        pullRequestId,
        "attempts = max_attempts, last_error = 'spent'",
      );
      await createGenerationProjection(handle, ctx).markFailed(
        {
          pullRequestId,
          kind: GenerationKinds.BRIEF,
          headSha: HEAD_1,
          baselineSha: null,
        },
        { code: GenerationFailureCodes.PROVIDER_TIMEOUT },
      );
      await drainQueue();
      const claimedWhileSpent = listClaimedPullRequests(claimed);

      const regenerated = await ingest.triggerOnDemand({ pullRequestId });
      await updateGenerateJob(utils, pullRequestId, "run_at = now()");
      await drainQueue();

      expect(claimedWhileSpent).not.toContain(String(pullRequestId));
      expect(regenerated).toBe(TriggerOnDemandOutcomes.QUEUED);
      expect(listClaimedPullRequests(claimed)).toEqual(
        expect.arrayContaining([String(pullRequestId)]),
      );
    } finally {
      await utils.release();
      await closeDb(handle);
    }
  });

  it("a sync queued while its head's sync runs leaves a runnable successor", async () => {
    const url = databaseUrl ?? "";
    await prepareQueue(url);
    const handle = createDb(url);
    const utils = await makeWorkerUtils({
      connectionString: url,
      logger: SILENT_GRAPHILE_LOGGER,
    });
    const installationId = randomInt(
      SMALLEST_FIXTURE_ID,
      SMALLEST_FIXTURE_ID + FIXTURE_ID_SPAN,
    );
    const ctx = parseTenantContext({ installationId });
    const repoId = makeRepoId(BigInt(installationId));
    const ingest = createIngestRoutines(handle, ctx);
    const github = makeGitHub(HEAD_1);
    const generator = stubGenerator();
    const syncEntry = createSyncEntryTask({
      handle,
      generator,
      contextProviders: createBuiltInContextProviders(DEFAULT_LINK_FETCH),
      github: createGitHubPort(github),
      publicBaseUrl: PUBLIC_URL,
      translate: createI18n().t,
    });
    let syncRuns = 0;
    const drainQueue = () =>
      runOnce({
        connectionString: url,
        logger: SILENT_GRAPHILE_LOGGER,
        taskList: buildSyncTaskList(ctx, syncEntry, () => {
          syncRuns += 1;
        }),
      });
    try {
      const triggered = await ingest.triggerGeneration({
        pullRequest: {
          repoId,
          prNumber: 7,
          repoSlug: "acme/widget",
          state: PrStates.OPEN,
        },
        headSha: HEAD_1,
        debounceSeconds: 0,
      });
      const pullRequestId = triggered.pullRequest.id;
      await createGenerationProjection(handle, ctx).markFailed(
        {
          pullRequestId,
          kind: GenerationKinds.BRIEF,
          headSha: HEAD_1,
          baselineSha: null,
        },
        { code: GenerationFailureCodes.PROVIDER_TIMEOUT },
      );
      const repo = createTenantRepository(handle, ctx);
      storeStaleWinnerOnFirstPost(github, repo, pullRequestId);
      await ingest.queueEntrySync({
        pullRequestId,
        headSha: HEAD_1,
        delaySeconds: 0,
      });

      await drainQueue();
      const successor = await readSyncJob(utils, pullRequestId);
      await startSyncJobNow(utils, pullRequestId);
      await drainQueue();

      expect(successor).toMatchObject({ locked_at: null, attempts: 0 });
      expect(syncRuns).toBe(2);
      expect(generator.calls).toEqual([]);
      const bodies = readLiveBodies(github);
      expect(bodies).toHaveLength(1);
      expect(bodies[0]).toContain("generation failed");
      const tracked = await repo.pullRequests.getById(pullRequestId);
      expect(tracked?.entryCommentId).toBe(
        [...github.readComments(REPO).keys()][0],
      );
      expect(await readSyncJob(utils, pullRequestId)).toBeUndefined();
    } finally {
      await utils.release();
      await closeDb(handle);
    }
  });
});
