import { WaitReasons } from "contract";
import type { TFunction } from "i18next";
import { GenerationStatuses, type GenerationUnitsParams } from "types";

import type { GenerationSummary, PrSummary } from "../../../../../../types";
import {
  isPastDailyCap,
  readCapReset,
  type CapReset,
} from "../../../../capped-head";
import { buildFailedNote, buildFailureLine } from "../../../../failed-head";
import { isNoLongerOpen } from "../../../../../../utils/pr-state";
import { hasStoredHeadBrief } from "../../../../../../utils/briefRouteState";
import { LatestPushStates, type LatestPushState } from "./types";

/** The latest push's states whose chip offers a run the route may take. */
const OFFER_STATUSES: ReadonlySet<string> = new Set([
  GenerationStatuses.FAILED,
  GenerationStatuses.AWAITING_TRIGGER,
]);

/** A pending head whose job spent its attempts has nothing left to run it. */
function readInFlightState(meta: PrSummary): LatestPushState {
  const stalled = meta.generation?.waitReason === WaitReasons.STALLED;
  if (stalled) {
    return LatestPushStates.STALLED;
  }
  return LatestPushStates.GENERATING;
}

/**
 * Absent once the latest push has its brief, or while nothing is known about
 * it. A state that offers a run reads `briefAvailable`, the regenerate
 * route's test for a failed head; any other asks whether the head has a
 * brief at all.
 */
export function readLatestPushState(
  meta: PrSummary,
): LatestPushState | undefined {
  const status = meta.generation?.status;
  const offersRun = status !== undefined && OFFER_STATUSES.has(status);
  const covered = offersRun ? meta.briefAvailable : hasStoredHeadBrief(meta);
  if (covered) {
    return undefined;
  }
  switch (status) {
    case GenerationStatuses.FAILED:
      return LatestPushStates.FAILED;
    case GenerationStatuses.AWAITING_TRIGGER:
      return LatestPushStates.AWAITING_TRIGGER;
    case GenerationStatuses.PENDING:
    case GenerationStatuses.RUNNING:
      return readInFlightState(meta);
    case GenerationStatuses.CAPPED:
      return LatestPushStates.CAPPED;
    default:
      return undefined;
  }
}

export interface CappedPushDetailInput {
  /** When the skip was recorded (the generation's `updatedAt`). */
  readonly cappedAt: string;
  readonly prState: PrSummary["state"];
  readonly appInstalled: boolean;
  /** A draft under a drafts-off instance: its next push queues nothing. */
  readonly awaitsReadyForReview: boolean;
  /** A large run's refusal: the runs it needed lead the detail. */
  readonly units?: GenerationUnitsParams | undefined;
}

/** When generation resumes after the skip, or that it already has. */
export function readCapResumeLine(
  t: TFunction,
  reset: CapReset | undefined,
): string {
  if (reset === undefined) {
    return t("pulls.latestPush.capped.resetUnknown");
  }
  if (reset.passed) {
    return t("pulls.latestPush.capped.resumed");
  }
  return t("pulls.latestPush.capped.resumes", { resetsAt: reset.resetsAt });
}

/**
 * When the next brief comes. The cap resets at 00:00 UTC after the skip and
 * a capped head never reruns: a url row reruns on a paste whatever its
 * state, an installation row on its next push while the PR is open, or on
 * ready for review when it is a draft its instance does not generate.
 */
export function buildCappedPushDetail(
  t: TFunction,
  {
    cappedAt,
    prState,
    appInstalled,
    awaitsReadyForReview: heldForReady,
    units,
  }: CappedPushDetailInput,
  now: Date = new Date(),
): string {
  if (units !== undefined && isPastDailyCap(units)) {
    const closed = appInstalled && isNoLongerOpen(prState);
    return closed
      ? t("pulls.failed.notOpenNote")
      : buildPastCapPushLines(t, units).join(" ");
  }
  const resumeLine = readCapResumeLine(t, readCapReset(cappedAt, now));
  const resume =
    units === undefined
      ? resumeLine
      : `${t("pulls.latestPush.capped.needsUnits", { count: units.needed, left: units.left })} ${resumeLine}`;
  if (!appInstalled) {
    return `${resume} ${t("pulls.latestPush.capped.repasteNote")}`;
  }
  if (isNoLongerOpen(prState)) {
    return t("pulls.failed.notOpenNote");
  }
  if (heldForReady) {
    return `${resume} ${t("pulls.capped.readyForReviewNote")}`;
  }
  return `${resume} ${t("pulls.latestPush.capped.nextPush")}`;
}

/** Only a raised cap briefs this push, so no reset or next push is promised. */
export function buildPastCapPushLines(
  t: TFunction,
  units: GenerationUnitsParams,
): string[] {
  const need = t("pulls.latestPush.capped.overCapUnits", {
    count: units.needed,
    cap: units.cap,
  });
  return [need, t("pulls.capped.overCapNote")];
}

export interface FailedPushDetailInput {
  readonly generation: GenerationSummary;
  readonly offersRegenerate: boolean;
  readonly prState: PrSummary["state"];
  readonly appInstalled: boolean;
  readonly awaitsReadyForReview: boolean;
}

/** The failed card's reason and note, as one line of the chip's explanation. */
export function buildFailedPushDetail(
  t: TFunction,
  {
    generation,
    offersRegenerate,
    prState,
    appInstalled,
    awaitsReadyForReview: heldForReady,
  }: FailedPushDetailInput,
): string {
  const { errorCode, errorDetail, attempts } = generation;
  const reason = buildFailureLine(t, errorCode, errorDetail);
  const note = buildFailedNote(t, {
    errorCode,
    attempts,
    offersRegenerate,
    prState,
    appInstalled,
    awaitsReadyForReview: heldForReady,
  });
  if (note === undefined) {
    return reason;
  }
  return `${reason} ${note}`;
}
