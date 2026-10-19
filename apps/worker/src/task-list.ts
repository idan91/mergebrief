import type { Task, TaskList } from "graphile-worker";
import { QueueTasks } from "types/jobs";
import { traceJob } from "./task/job-span";
import { SWEEP_AUDIT_TASK } from "./task/sweep-audit";
import { SWEEP_PULL_REQUESTS_TASK } from "./task/sweep-pull-requests";
import { SWEEP_SESSIONS_TASK } from "./task/sweep-sessions";

export interface WorkerTasks {
  readonly generate: Task;
  readonly recoverGeneration: Task;
  readonly sweepAudit: Task;
  readonly sweepSessions: Task;
  readonly sweepPullRequests: Task;
}

export function buildTaskList(tasks: WorkerTasks): TaskList {
  return {
    [QueueTasks.GENERATE]: traceJob(QueueTasks.GENERATE, tasks.generate),
    [QueueTasks.RECOVER_GENERATION]: traceJob(
      QueueTasks.RECOVER_GENERATION,
      tasks.recoverGeneration,
    ),
    // Scheduled jobs: instance-wide, not tenant-scoped, worker-only.
    [SWEEP_AUDIT_TASK]: traceJob(SWEEP_AUDIT_TASK, tasks.sweepAudit),
    [SWEEP_SESSIONS_TASK]: traceJob(SWEEP_SESSIONS_TASK, tasks.sweepSessions),
    [SWEEP_PULL_REQUESTS_TASK]: traceJob(
      SWEEP_PULL_REQUESTS_TASK,
      tasks.sweepPullRequests,
    ),
  };
}
