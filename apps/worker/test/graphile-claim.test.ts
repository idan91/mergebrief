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
  ensureAppSchema,
  GenerationKinds,
  parseTenantContext,
  RegenerateOutcomes,
  type PullRequestRowId,
} from "persistence";
import { startTestTracing } from "logging/testing";
import { readTestPostgresUrl } from "persistence/testing";
import { GenerationFailureCodes, PrStates } from "types";
import { describe, expect, it } from "vitest";
import { parseGeneratePayload } from "../src/task/payload";
import { buildTaskList } from "../src/task-list";
import { HEAD_1, makeRepoId } from "./generate/helpers";

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
    sweepAudit: failUnexpectedTask,
    sweepSessions: failUnexpectedTask,
    sweepPullRequests: failUnexpectedTask,
    sweepWebhookDeliveries: failUnexpectedTask,
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

      const regenerated = await ingest.regenerateFailedHead({ pullRequestId });
      await updateGenerateJob(utils, pullRequestId, "run_at = now()");
      await drainQueue();

      expect(claimedWhileSpent).not.toContain(String(pullRequestId));
      expect(regenerated).toBe(RegenerateOutcomes.QUEUED);
      expect(listClaimedPullRequests(claimed)).toEqual(
        expect.arrayContaining([String(pullRequestId)]),
      );
    } finally {
      await utils.release();
      await closeDb(handle);
    }
  });
});
