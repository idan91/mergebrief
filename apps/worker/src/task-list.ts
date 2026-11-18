import type { Task, TaskList } from "graphile-worker";
import { QueueTasks } from "types/jobs";
import { traceJob } from "./task/job-span";
import { RECONCILE_WEBHOOK_DELIVERIES_TASK } from "./task/reconcile-webhook-deliveries/consts";
import { SWEEP_AUDIT_TASK } from "./task/sweep-audit";
import { SWEEP_GENERATION_PARTS_TASK } from "./task/sweep-generation-parts";
import { SWEEP_PULL_REQUESTS_TASK } from "./task/sweep-pull-requests";
import { SWEEP_SESSIONS_TASK } from "./task/sweep-sessions";
import { SWEEP_WEBHOOK_DELIVERIES_TASK } from "./task/sweep-webhook-deliveries";

export interface WorkerTasks {
  readonly generate: Task;
  readonly recoverGeneration: Task;
  readonly syncEntry: Task;
  readonly sweepAudit: Task;
  readonly sweepSessions: Task;
  readonly sweepPullRequests: Task;
  readonly sweepWebhookDeliveries: Task;
  readonly sweepGenerationParts: Task;
  readonly reconcileWebhookDeliveries: Task;
}

/** The large pool's tasks: the same runs, told their pool. */
export interface LargePoolTasks {
  readonly generateLarge: Task;
  readonly recoverGenerationLarge: Task;
}

export function buildLargePoolTaskList(tasks: LargePoolTasks): TaskList {
  return {
    [QueueTasks.GENERATE_LARGE]: traceJob(
      QueueTasks.GENERATE_LARGE,
      tasks.generateLarge,
    ),
    [QueueTasks.RECOVER_GENERATION_LARGE]: traceJob(
      QueueTasks.RECOVER_GENERATION_LARGE,
      tasks.recoverGenerationLarge,
    ),
  };
}

export function buildTaskList(tasks: WorkerTasks): TaskList {
  return {
    [QueueTasks.GENERATE]: traceJob(QueueTasks.GENERATE, tasks.generate),
    [QueueTasks.RECOVER_GENERATION]: traceJob(
      QueueTasks.RECOVER_GENERATION,
      tasks.recoverGeneration,
    ),
    [QueueTasks.SYNC_ENTRY]: traceJob(QueueTasks.SYNC_ENTRY, tasks.syncEntry),
    // Scheduled jobs: instance-wide, not tenant-scoped, worker-only.
    [SWEEP_AUDIT_TASK]: traceJob(SWEEP_AUDIT_TASK, tasks.sweepAudit),
    [SWEEP_SESSIONS_TASK]: traceJob(SWEEP_SESSIONS_TASK, tasks.sweepSessions),
    [SWEEP_PULL_REQUESTS_TASK]: traceJob(
      SWEEP_PULL_REQUESTS_TASK,
      tasks.sweepPullRequests,
    ),
    [SWEEP_WEBHOOK_DELIVERIES_TASK]: traceJob(
      SWEEP_WEBHOOK_DELIVERIES_TASK,
      tasks.sweepWebhookDeliveries,
    ),
    [SWEEP_GENERATION_PARTS_TASK]: traceJob(
      SWEEP_GENERATION_PARTS_TASK,
      tasks.sweepGenerationParts,
    ),
    [RECONCILE_WEBHOOK_DELIVERIES_TASK]: traceJob(
      RECONCILE_WEBHOOK_DELIVERIES_TASK,
      tasks.reconcileWebhookDeliveries,
    ),
  };
}
