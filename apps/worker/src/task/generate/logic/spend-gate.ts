import { capForRepo } from "generators";
import type { LogFields } from "logging";
import {
  type StartRunInput,
  GenerationPhases,
  GenerationStatuses,
} from "persistence";
import type { Mutable } from "types/utils";
import { entryCommentCappedBody } from "../../entry-comment";
import type { ParsedGeneratePayload } from "../../payload";
import { utcDayBounds } from "../../spend";
import type { SpendGateInputs } from "../types";

/**
 * The daily generation cap. The start and the `running` mark happen in one
 * store transaction under the repo's advisory lock, so a run never counts
 * itself and N slots or processes cannot start past the cap together. Returns
 * true when the run is capped: the projection is terminal `capped` (or left
 * `failed`) and the caller stops.
 */
export async function applySpendGate(
  payload: ParsedGeneratePayload,
  inputs: SpendGateInputs,
): Promise<boolean> {
  const { deps, projection, target, prRow, repoSlug, job, log } = inputs;

  const cap =
    deps.spend === undefined ? null : capForRepo(deps.spend, repoSlug);
  const day = utcDayBounds(new Date());
  const startInput: Mutable<StartRunInput> = {
    target,
    phase: GenerationPhases.FETCHING,
    repoId: prRow.repoId,
    from: day.from,
    to: day.to,
  };
  if (cap !== null) {
    startInput.cap = cap;
  }
  const start = await projection.startRun(startInput);
  if (!start.ok) {
    return false;
  }

  if (!start.value.started) {
    if (cap === null) {
      throw new Error("generate: startRun refused a run with no cap");
    }
    await recordCappedRun(payload, inputs, {
      cap,
      resetsAt: day.to,
      dayUtc: day.label,
    });
    return true;
  }

  const startFields: LogFields = {
    evt: "generation.start",
    waitMs: measureQueueWait(job, start.value.createdAt),
  };
  if (job !== undefined) startFields["attempt"] = job.attempts;
  log.info("generate: run started", startFields);
  return false;
}

/**
 * Time between the job becoming runnable and this slot picking it up. The
 * projection row's created_at is the fallback for a job-less call; it counts
 * from the first push of that head, so a re-triggered head reads long.
 * Postgres stamps both while this reads the process clock, so skew is
 * clamped rather than surfacing as a negative wait.
 */
function measureQueueWait(
  job: SpendGateInputs["job"],
  createdAt: Date,
): number {
  const since = job === undefined ? createdAt : job.run_at;
  return Math.max(0, Date.now() - since.getTime());
}

interface CappedRunFacts {
  readonly cap: number;
  readonly resetsAt: Date;
  readonly dayUtc: string;
}

async function recordCappedRun(
  payload: ParsedGeneratePayload,
  inputs: SpendGateInputs,
  facts: CappedRunFacts,
): Promise<void> {
  const {
    deps,
    projection,
    target,
    prRow,
    repoSlug,
    entryCommentManager,
    log,
  } = inputs;
  const { headSha } = payload;

  log.warn("generate: daily generation cap reached, skipping this run", {
    evt: "spend.cap.trip",
    repo: repoSlug,
    cap: facts.cap,
    dayUtc: facts.dayUtc,
  });
  if (
    entryCommentManager.getCurrentId() !== null &&
    payload.grantId === undefined
  ) {
    // UPDATE ONLY: a capped PR never gets an Entry comment created for it,
    // the cap must not make MergeBrief louder on a thread than it was.
    await entryCommentManager.refresh(
      entryCommentCappedBody({
        publicBaseUrl: deps.publicBaseUrl,
        repoId: prRow.repoId,
        prNumber: prRow.prNumber,
        headSha,
        resetsAt: facts.resetsAt,
      }),
    );
  }

  // Do NOT overwrite a `failed` row: an at-cap graphile retry lands here
  // with the previous attempt's real failure recorded, and stamping
  // `capped` over it would erase why the job actually broke.
  const current = await projection.get(target);
  if (current?.status !== GenerationStatuses.FAILED) {
    await projection.markCapped(target);
  }
}
