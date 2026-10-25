import type { TFunction } from "i18next";
import { GenerationStatuses } from "types";
import type { Mutable } from "types/utils";

import type { GenerationSummary, PrSummary } from "../../../../../types";
import { readCapResetsAt } from "../../../capped-head";
import {
  buildFailedNote,
  buildFailureLine,
  readOffersRegenerate,
} from "../../../failed-head";
import { readOffersTrigger } from "../../../trigger-offer";
import { isNoLongerOpen } from "../../../../../utils/pr-state";
import { hasStoredHeadBrief } from "../../../../../utils/briefRouteState";
import { awaitsReadyForReview } from "../../../../../utils/draft-policy";
import {
  LatestPushStates,
  type LatestPushCopy,
  type LatestPushState,
} from "./types";

/** The latest push's states whose notice carries a run the route may take. */
const OFFER_STATUSES: ReadonlySet<string> = new Set([
  GenerationStatuses.FAILED,
  GenerationStatuses.AWAITING_TRIGGER,
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
    case GenerationStatuses.AWAITING_TRIGGER:
      return LatestPushStates.AWAITING_TRIGGER;
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
    awaitsReadyForReview: heldForReady,
  }: CappedPushDetailInput,
  now: Date = new Date(),
): string {
  const resume = readCapResumeLine(t, cappedAt, now);
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

function describeFailedPush(
  t: TFunction,
  meta: PrSummary,
  generation: GenerationSummary,
): LatestPushCopy {
  const offersRegenerate = readOffersRegenerate({
    errorCode: generation.errorCode,
    viewerCanPush: meta.viewerCanPush,
    appInstalled: meta.appInstalled,
    prState: meta.state,
  });
  const copy: Mutable<LatestPushCopy> = {
    label: t("pulls.latestPush.failed.label"),
    title: t("pulls.latestPush.failed.title"),
    detail: buildFailedPushDetail(t, {
      generation,
      offersRegenerate,
      prState: meta.state,
      appInstalled: meta.appInstalled,
      awaitsReadyForReview: awaitsReadyForReview(meta),
    }),
  };
  if (offersRegenerate) {
    copy.actionLabels = {
      action: t("pulls.failed.regenerate.action"),
      pending: t("pulls.failed.regenerate.pending"),
    };
  }
  return copy;
}

function describeAwaitingPush(t: TFunction, meta: PrSummary): LatestPushCopy {
  const copy: Mutable<LatestPushCopy> = {
    label: t("pulls.awaitingTrigger.notice.label"),
    title: t("pulls.awaitingTrigger.notice.title"),
  };
  if (isNoLongerOpen(meta.state)) {
    copy.label = t("pulls.awaitingTrigger.notice.notOpenLabel");
    copy.title = t("pulls.awaitingTrigger.notice.notOpenTitle");
    copy.detail = t("pulls.awaitingTrigger.notOpenCopy");
  }
  const offersGenerate = readOffersTrigger({
    prState: meta.state,
    viewerCanPush: meta.viewerCanPush,
    appInstalled: meta.appInstalled,
  });
  if (offersGenerate) {
    copy.actionLabels = {
      action: t("pulls.awaitingTrigger.generate.action"),
      pending: t("pulls.awaitingTrigger.generate.pending"),
    };
  }
  return copy;
}

/** What the notice says for the latest push's state, and whether it offers a run. */
export function describeLatestPush(
  t: TFunction,
  meta: PrSummary,
  state: LatestPushState,
): LatestPushCopy | undefined {
  const { generation } = meta;
  if (generation === undefined) {
    return undefined;
  }
  switch (state) {
    case LatestPushStates.FAILED:
      return describeFailedPush(t, meta, generation);
    case LatestPushStates.AWAITING_TRIGGER:
      return describeAwaitingPush(t, meta);
    case LatestPushStates.GENERATING:
      return {
        label: t("pulls.latestPush.generating.label"),
        title: t("pulls.latestPush.generating.title"),
      };
    case LatestPushStates.CAPPED:
      return {
        label: t("pulls.latestPush.capped.label"),
        title: t("pulls.latestPush.capped.title"),
        detail: buildCappedPushDetail(t, {
          cappedAt: generation.updatedAt,
          prState: meta.state,
          appInstalled: meta.appInstalled,
          awaitsReadyForReview: awaitsReadyForReview(meta),
        }),
      };
  }
}
