import type { TFunction } from "i18next";
import { GenerationStatuses, PrStates } from "types";

import type { GenerationSummary, PrSummary } from "../../../../../types";
import { readCapResetsAt } from "../../../capped-head";
import { buildFailedNote, buildFailureLine } from "../../../failed-head";
import { hasStoredHeadBrief } from "../../../../../utils/briefRouteState";
import { LatestPushStates, type LatestPushState } from "./types";

/** The latest push's states whose notice carries a run the route may take. */
const OFFER_STATUSES: ReadonlySet<string> = new Set([
  GenerationStatuses.FAILED,
]);

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
    case GenerationStatuses.PENDING:
    case GenerationStatuses.RUNNING:
      return LatestPushStates.GENERATING;
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
}

function readCapResumeLine(
  t: TFunction,
  cappedAtIso: string,
  now: Date,
): string {
  const resetsAt = readCapResetsAt(cappedAtIso);
  if (resetsAt === undefined) {
    return t("pulls.latestPush.capped.resetUnknown");
  }
  if (resetsAt.getTime() <= now.getTime()) {
    return t("pulls.latestPush.capped.resumed");
  }
  return t("pulls.latestPush.capped.resumes", { resetsAt });
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
    awaitsReadyForReview,
  }: CappedPushDetailInput,
  now: Date = new Date(),
): string {
  const resume = readCapResumeLine(t, cappedAt, now);
  if (!appInstalled) {
    return `${resume} ${t("pulls.latestPush.capped.repasteNote")}`;
  }
  const noLongerOpen =
    prState === PrStates.CLOSED || prState === PrStates.MERGED;
  if (noLongerOpen) {
    return t("pulls.failed.notOpenNote");
  }
  if (awaitsReadyForReview) {
    return `${resume} ${t("pulls.capped.readyForReviewNote")}`;
  }
  return `${resume} ${t("pulls.latestPush.capped.nextPush")}`;
}

export interface FailedPushDetailInput {
  readonly generation: GenerationSummary;
  readonly offersRegenerate: boolean;
  readonly prState: PrSummary["state"];
  readonly appInstalled: boolean;
  readonly awaitsReadyForReview: boolean;
}

/** The failed card's reason and note, on one line beside the chip. */
export function buildFailedPushDetail(
  t: TFunction,
  {
    generation,
    offersRegenerate,
    prState,
    appInstalled,
    awaitsReadyForReview,
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
    awaitsReadyForReview,
  });
  if (note === undefined) {
    return reason;
  }
  return `${reason} ${note}`;
}
