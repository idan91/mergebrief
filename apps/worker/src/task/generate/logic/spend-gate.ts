import type { LogFields } from "logging";
import {
  ChargeOutcomes,
  ClaimOutcomes,
  type ChargeRunInput,
  type ClaimRunInput,
  type ClaimRunOutcome,
  type RecoveryJobInput,
} from "persistence";
import { GenerationPhases, GenerationStatuses } from "types/generations";
import type { Mutable } from "types/utils";
import { entryCommentCappedBody } from "../../entry-comment";
import type { ParsedGeneratePayload } from "../../payload";
import { utcDayBounds } from "../../spend";
import { CLAIM_LEASE_MS } from "../consts";
import type { RunContext, SpendCharge, SpendGateInputs } from "../types";
import { getAfterLeaseDelaySeconds } from "./claim-recovery";

/** Control-flow signal: the cap refused a stored-brief run's first paid call. */
export class SpendCappedSignal extends Error {}

/**
 * The daily generation cap, one number for the whole instance. The count and
 * the claim happen in one store transaction under the instance advisory lock,
 * so a run never counts itself and N slots or processes cannot start past the
 * cap together. The claim queues the head's recovery job in the same
 * transaction, unless this run is one. A capped run leaves the projection
 * terminal `capped` (or `failed`); a held or finished row is reported untouched.
 */
export async function applySpendGate(
  payload: ParsedGeneratePayload,
  inputs: SpendGateInputs,
): Promise<ClaimRunOutcome> {
  const { deps, projection, target, job, log } = inputs;

  const cap = deps.spend?.maxGenerationsPerDay ?? null;
  const day = utcDayBounds(new Date());
  const claimInput: Mutable<ClaimRunInput> = {
    target,
    phase: GenerationPhases.FETCHING,
    from: day.from,
    to: day.to,
    leaseMs: CLAIM_LEASE_MS,
  };
  if (cap !== null) {
    claimInput.cap = cap;
  }
  if (!inputs.recovering) {
    const recovery: Mutable<RecoveryJobInput> = {
      delaySeconds: getAfterLeaseDelaySeconds(CLAIM_LEASE_MS),
    };
    if (payload.grantId !== undefined) {
      recovery.grantId = payload.grantId;
    }
    claimInput.recovery = recovery;
  }
  const claim = await projection.claimRun(claimInput);
  if (!claim.ok) {
    throw new Error(`generate: could not claim the run: ${claim.error.code}`);
  }

  if (claim.value.kind === ClaimOutcomes.CAPPED) {
    if (cap === null) {
      throw new Error("generate: claimRun capped a run with no cap");
    }
    await recordCappedRun(payload, inputs, {
      cap,
      resetsAt: day.to,
      dayUtc: day.label,
    });
  }
  if (claim.value.kind === ClaimOutcomes.CLAIMED) {
    const startFields: LogFields = {
      evt: "generation.start",
      waitMs: measureQueueWait(job, claim.value.createdAt),
    };
    if (job !== undefined) {
      startFields["attempt"] = job.attempts;
    }
    log.info("generate: run started", startFields);
  }
  return claim.value;
}

/**
 * The cap as a ceiling first, for a run over a stored brief: it produces no
 * brief generation, but it may still owe a checkpoint delta or a narrative,
 * so at the cap it is refused before any work. The caller still posts the
 * ready Entry the run owes, which reaches no model. Count only, no lock and
 * no row transition; a run that goes on to pay is charged by `createSpendCharge`.
 */
export async function refuseAtCap(
  payload: ParsedGeneratePayload,
  inputs: SpendGateInputs,
): Promise<boolean> {
  const { deps, projection, repoSlug, log } = inputs;

  const cap = deps.spend?.maxGenerationsPerDay ?? null;
  if (cap === null) {
    return false;
  }
  const day = utcDayBounds(new Date());
  const started = await projection.countStartedRuns({
    from: day.from,
    to: day.to,
  });
  if (started < cap) {
    return false;
  }

  log.warn("generate: daily generation cap reached, stored-brief run refused", {
    evt: "spend.cap.trip",
    repo: repoSlug,
    cap,
    dayUtc: day.label,
    headSha: payload.headSha,
  });
  return true;
}

/**
 * A run over a stored brief that holds no claim is charged at its first paid
 * call rather than at the gate: the count and its attempt row in one store
 * transaction under the cap lock, as a claim is. A provider-free run is never
 * charged; a claimed run was charged by its claim.
 */
export function createSpendCharge(context: RunContext): SpendCharge {
  if (context.run.runId !== undefined) {
    return async () => {};
  }

  let charged: Promise<void> | undefined;
  return async () => {
    charged ??= chargeStoredBriefRun(context);
    await charged;
  };
}

async function chargeStoredBriefRun(context: RunContext): Promise<void> {
  const { deps, payload, projection, target, repoSlug, log } = context;

  const cap = deps.spend?.maxGenerationsPerDay ?? null;
  const day = utcDayBounds(new Date());
  const chargeInput: Mutable<ChargeRunInput> = {
    target,
    from: day.from,
    to: day.to,
  };
  if (cap !== null) {
    chargeInput.cap = cap;
  }
  const charge = await projection.chargeRun(chargeInput);
  if (!charge.ok) {
    throw new Error(`generate: could not charge the run: ${charge.error.code}`);
  }
  if (charge.value.kind === ChargeOutcomes.CHARGED) {
    log.info("generate: stored-brief run charged to the daily cap");
    return;
  }

  log.warn("generate: daily generation cap reached, stored-brief run refused", {
    evt: "spend.cap.trip",
    repo: repoSlug,
    cap,
    dayUtc: day.label,
    headSha: payload.headSha,
  });
  throw new SpendCappedSignal("daily generation cap reached");
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
    existingBrief,
    pickedUpAt,
    log,
  } = inputs;
  const { headSha } = payload;

  log.warn("generate: daily generation cap reached, skipping this run", {
    evt: "spend.cap.trip",
    repo: repoSlug,
    cap: facts.cap,
    dayUtc: facts.dayUtc,
  });
  // A stored brief still owes its ready Entry, which the caller posts.
  const showsCapped =
    entryCommentManager.getCurrentId() !== null &&
    payload.grantId === undefined &&
    existingBrief === undefined;
  if (showsCapped) {
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

  // A claimed run over a stored brief: the brief stands, only its follow-on
  // work was capped.
  if (existingBrief !== undefined) {
    await projection.settleStoredBrief(target, pickedUpAt);
    return;
  }
  // Do NOT overwrite a `failed` row: an at-cap graphile retry lands here
  // with the previous attempt's real failure recorded, and stamping
  // `capped` over it would erase why the job actually broke.
  const current = await projection.get(target);
  if (current?.status !== GenerationStatuses.FAILED) {
    await projection.markCapped(target);
  }
}
