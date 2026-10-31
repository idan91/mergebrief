import type { LogFields } from "logging";
import {
  ChargeOutcomes,
  ClaimOutcomes,
  type ChargeRunInput,
  type ClaimRunInput,
  type ClaimUnitsInput,
  type ClaimRunOutcome,
  type RecoveryJobInput,
  type UtcDay,
  utcDayBounds,
} from "persistence";
import {
  GenerationPhases,
  GenerationStatuses,
  type GenerationUnitsParams,
  type Mutable,
} from "types";
import {
  buildEntryCommentCappedBody,
  isPastDailyCap,
} from "../../entry-comment";
import type { ParsedGeneratePayload } from "../../payload";
import { CLAIM_LEASE_MS } from "../consts";
import {
  HeadReadings,
  type RunContext,
  type SpendCharge,
  type SpendGateInputs,
} from "../types";
import { getAfterLeaseDelaySeconds } from "./claim-recovery";
import { queueEntrySync, queueEntrySyncOnLostWrite } from "./entry-sync";
import { ClaimLostSignal, SpendCappedSignal } from "./run-signals";

/**
 * The daily generation cap, one number for the whole instance. The count and
 * the claim happen in one store transaction under the instance advisory lock,
 * so a run never counts itself and N slots or processes cannot start past the
 * cap together. The claim queues the head's recovery job in the same
 * transaction; a takeover's claim queues its successor, which ends the
 * takeover job's own retries and carries them on. A capped run leaves the projection
 * terminal `capped` (or `failed`); a held or finished row is reported untouched.
 * A row that is gone (its pull request deleted) stands the run down.
 */
export async function applySpendGate(
  payload: ParsedGeneratePayload,
  inputs: SpendGateInputs,
): Promise<ClaimRunOutcome> {
  const { deps, projection, target, job, log } = inputs;

  const { day, cap, storeInput } = readTodayCap(deps);
  const claimInput: Mutable<ClaimRunInput> = {
    ...storeInput,
    target,
    phase: GenerationPhases.FETCHING,
    leaseMs: CLAIM_LEASE_MS,
  };
  const recovery: Mutable<RecoveryJobInput> = {
    delaySeconds: getAfterLeaseDelaySeconds(CLAIM_LEASE_MS),
  };
  if (payload.grantId !== undefined) {
    recovery.grantId = payload.grantId;
  }
  claimInput.recovery = recovery;
  const claim = await projection.claimRun(claimInput);
  if (!claim.ok) {
    throw new ClaimLostSignal(claim.error.message);
  }

  if (claim.value.kind === ClaimOutcomes.CAPPED) {
    if (cap === undefined) {
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

  const { day, cap } = readTodayCap(deps);
  if (cap === undefined) {
    return false;
  }
  const started = await projection.countStartedRuns({
    from: day.from,
    to: day.to,
  });
  if (started < cap) {
    return false;
  }

  log.warn(
    "generate: daily generation cap reached, stored-brief run refused",
    buildCapTripFields({ repoSlug, cap, day, headSha: payload.headSha }),
  );
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

  const { day, cap, storeInput } = readTodayCap(deps);
  const chargeInput: ChargeRunInput = { ...storeInput, target };
  const charge = await projection.chargeRun(chargeInput);
  if (!charge.ok) {
    throw new ClaimLostSignal(charge.error.message);
  }
  if (charge.value.kind === ChargeOutcomes.CHARGED) {
    log.info("generate: stored-brief run charged to the daily cap");
    return;
  }

  log.warn(
    "generate: daily generation cap reached, stored-brief run refused",
    buildCapTripFields({ repoSlug, cap, day, headSha: payload.headSha }),
  );
  throw new SpendCappedSignal("daily generation cap reached");
}

/**
 * A large run claims the units its detail calls cost, under the same lock as
 * its claim. At the cap it ends its claim `capped` with the units it needed
 * and what the day had left, says so on an Entry that already exists, and
 * stops through `SpendCappedSignal`.
 */
export async function claimRunUnits(
  context: RunContext,
  units: number,
): Promise<void> {
  const { deps, payload, projection, target, run, repoSlug, log } = context;
  const runId = run.runId;
  if (runId === undefined) {
    throw new Error("generate: claimRunUnits needs a claimed run");
  }

  const { day, cap, storeInput } = readTodayCap(deps);
  const unitsInput: ClaimUnitsInput = { ...storeInput, runId, units };
  const claim = await projection.claimUnits(unitsInput);
  if (!claim.ok) {
    throw new ClaimLostSignal(claim.error.message);
  }
  if (claim.value.kind === ChargeOutcomes.CHARGED) {
    return;
  }

  const needs: GenerationUnitsParams = {
    needed: claim.value.needed,
    left: claim.value.left,
    cap: claim.value.cap,
  };
  const message = isPastDailyCap(needs)
    ? "generate: large run needs more runs than the daily cap allows, refused"
    : "generate: daily generation cap reached, large run refused";
  log.warn(message, {
    ...buildCapTripFields({ repoSlug, cap, day, headSha: payload.headSha }),
    needed: needs.needed,
    left: needs.left,
  });
  const finished = await projection.finishRun(target, runId, {
    status: GenerationStatuses.CAPPED,
    units: needs,
  });
  if (!finished.ok) {
    throw new ClaimLostSignal(finished.error.message);
  }
  await updateCappedEntry(payload, context, {
    resetsAt: day.to,
    units: needs,
  });
  throw new SpendCappedSignal("daily generation cap reached");
}

/** What every store call under the cap takes: the day's bounds, and the cap unless the Instance has none. */
type CapStoreInput = Pick<ClaimRunInput, "cap" | "from" | "to">;

interface TodayCap {
  readonly day: UtcDay;
  readonly cap?: number;
  readonly storeInput: CapStoreInput;
}

/** Today's UTC day and the Instance's cap over it, read once per store call. */
function readTodayCap(deps: SpendGateInputs["deps"]): TodayCap {
  const day = utcDayBounds(new Date());
  const cap = deps.spend?.maxGenerationsPerDay ?? null;
  const storeInput: Mutable<CapStoreInput> = { from: day.from, to: day.to };
  const todayCap: Mutable<TodayCap> = { day, storeInput };
  if (cap !== null) {
    storeInput.cap = cap;
    todayCap.cap = cap;
  }
  return todayCap;
}

interface CapTripFacts {
  readonly repoSlug: string;
  readonly cap: number | undefined;
  readonly day: UtcDay;
  readonly headSha: string;
}

function buildCapTripFields(facts: CapTripFacts): LogFields {
  return {
    evt: "spend.cap.trip",
    repo: facts.repoSlug,
    cap: facts.cap,
    dayUtc: facts.day.label,
    headSha: facts.headSha,
  };
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

interface CappedEntryFacts {
  readonly resetsAt: Date;
  /** A large run's refusal; absent when the run's claim met the cap. */
  readonly units?: GenerationUnitsParams;
}

type CappedEntryInputs = Pick<
  SpendGateInputs,
  "deps" | "prRow" | "entryCommentManager" | "existingBrief" | "watch" | "log"
>;

/**
 * UPDATE ONLY: a capped PR never gets an Entry comment created for it, the
 * cap must not make MergeBrief louder on a thread than it was. A stored brief
 * still owes its ready Entry, which the caller posts. A post that fails, or
 * stands down on an unread head, queues the head's sync.
 */
async function updateCappedEntry(
  payload: ParsedGeneratePayload,
  inputs: CappedEntryInputs,
  facts: CappedEntryFacts,
): Promise<void> {
  const { deps, prRow, entryCommentManager, existingBrief, watch, log } =
    inputs;
  const showsCapped =
    entryCommentManager.getCurrentId() !== null &&
    payload.grantId === undefined &&
    existingBrief === undefined;
  if (!showsCapped) {
    return;
  }
  const head = await watch.readHead();
  if (head.kind === HeadReadings.MOVED) {
    return;
  }
  if (head.kind === HeadReadings.UNREAD) {
    log.warn("generate: head unread, the capped Entry stands down", {
      error: head.error,
    });
    await queueEntrySync({ deps, payload, log });
    return;
  }

  const cappedBody = buildEntryCommentCappedBody(deps.translate, {
    publicBaseUrl: deps.publicBaseUrl,
    repoId: prRow.repoId,
    prNumber: prRow.prNumber,
    headSha: payload.headSha,
    resetsAt: facts.resetsAt,
    units: facts.units,
  });
  const write = await entryCommentManager.refresh(cappedBody);
  await queueEntrySyncOnLostWrite({ deps, payload, log }, write);
}

async function recordCappedRun(
  payload: ParsedGeneratePayload,
  inputs: SpendGateInputs,
  facts: CappedRunFacts,
): Promise<void> {
  const { projection, target, repoSlug, existingBrief, pickedUpAt, log } =
    inputs;
  log.warn("generate: daily generation cap reached, skipping this run", {
    evt: "spend.cap.trip",
    repo: repoSlug,
    cap: facts.cap,
    dayUtc: facts.dayUtc,
  });
  await updateCappedEntry(payload, inputs, facts);

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
