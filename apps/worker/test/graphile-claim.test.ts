// Real graphile over a real Postgres: the job persistence enqueues is claimed
// through the worker's own task list, and its payload passes the worker's
// parser. The stubbed jobs table cannot prove either. Runs only against
// MERGEBRIEF_TEST_POSTGRES_URL: skipped locally when unset, red under CI.
import { randomInt } from "node:crypto";
import {
  Logger as GraphileLogger,
  runMigrations,
  runOnce,
  type Task,
  type TaskList,
} from "graphile-worker";
import {
  closeDb,
  createDb,
  createIngestRoutines,
  ensureAppSchema,
  parseTenantContext,
} from "persistence";
import { startTestTracing } from "logging/testing";
import { readTestPostgresUrl } from "persistence/testing";
import { PrStates } from "types/pull-requests";
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

      const jobs = tracing
        .readFinishedSpans()
        .filter((span) => span.name === "process generate");
      const ours = jobs.filter((span) =>
        span.links.some((link) => link.traceId === enqueue.traceId),
      );
      expect(claimedIds).toContain(pullRequestId);
      expect(ours).toHaveLength(1);
      expect(ours[0]?.links).toEqual([enqueue]);
    } finally {
      await tracing.stop();
      await closeDb(handle);
    }
  });
});
