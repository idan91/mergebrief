import type { Task } from "graphile-worker";
import { runInJobSpan } from "logging";
import type { QueueTask } from "types/jobs";
import { readPayloadTraceparent } from "./payload";
import type { SWEEP_AUDIT_TASK } from "./sweep-audit";
import type { SWEEP_PULL_REQUESTS_TASK } from "./sweep-pull-requests";
import type { SWEEP_SESSIONS_TASK } from "./sweep-sessions";
import type { SWEEP_WEBHOOK_DELIVERIES_TASK } from "./sweep-webhook-deliveries";

/** Every task id the worker registers, queued and scheduled. */
type WorkerTaskId =
  | QueueTask
  | typeof SWEEP_AUDIT_TASK
  | typeof SWEEP_SESSIONS_TASK
  | typeof SWEEP_PULL_REQUESTS_TASK
  | typeof SWEEP_WEBHOOK_DELIVERIES_TASK;

const MESSAGING_SYSTEM = "graphile_worker";

/**
 * Runs every claim of `taskId` inside one root OTel span per job, linked to
 * the enqueue when its payload carries a `traceparent`. Scheduled jobs carry
 * none and start a plain trace.
 */
export function traceJob(taskId: WorkerTaskId, task: Task): Task {
  return (payload, helpers) =>
    runInJobSpan(
      {
        name: `process ${taskId}`,
        traceparent: readPayloadTraceparent(payload),
        attributes: {
          "messaging.system": MESSAGING_SYSTEM,
          "messaging.operation.type": "process",
          "messaging.destination.name": taskId,
          "messaging.message.id": helpers.job.id,
          "messaging.graphile_worker.attempts": helpers.job.attempts,
        },
      },
      // The task's own result passes through: a batch job reports per item.
      async () => task(payload, helpers),
    );
}
