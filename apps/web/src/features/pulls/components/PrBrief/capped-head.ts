/**
 * The cap counts a UTC calendar day, so it resets at the first midnight UTC
 * strictly after the skip was recorded. Derived from the SKIP time, never
 * from "now": a capped row left over from an earlier day must not claim to
 * be waiting on tonight.
 */
import type { TFunction } from "i18next";
import type { PrSummary } from "../../types";
import { isNoLongerOpen } from "../../utils/pr-state";

export function readCapResetsAt(cappedAtIso: string): Date | undefined {
  const cappedAt = new Date(cappedAtIso);
  if (Number.isNaN(cappedAt.getTime())) {
    return undefined;
  }
  return new Date(
    Date.UTC(
      cappedAt.getUTCFullYear(),
      cappedAt.getUTCMonth(),
      cappedAt.getUTCDate() + 1,
    ),
  );
}

/**
 * The capped heading. The reset time renders in the VIEWER's zone (the
 * operator's UTC boundary is an implementation detail). An unparsable
 * timestamp degrades to the capless sentence rather than printing
 * "Invalid Date".
 */
export function buildCappedLabel(
  t: TFunction,
  cappedAtIso: string,
  now: Date = new Date(),
): string {
  const resetsAt = readCapResetsAt(cappedAtIso);
  if (resetsAt === undefined) {
    return t("pulls.capped.reached");
  }
  if (resetsAt.getTime() <= now.getTime()) {
    // The window already rolled over: the cap is no longer holding anything
    // back, so promising a future resume time would be a lie.
    return t("pulls.capped.resumed");
  }
  // The template's datetime formatter renders in the ACTIVE locale.
  return t("pulls.capped.resumes", { resetsAt });
}

export interface CappedCardDetailInput {
  readonly prState: PrSummary["state"];
  readonly appInstalled: boolean;
  /** A draft under a drafts-off instance: its next push queues nothing. */
  readonly awaitsReadyForReview: boolean;
}

/**
 * What the cap is and how this head gets a brief. A capped head never reruns
 * on its own: a url row reruns on a paste whatever its state, an
 * installation row on its next push while the PR is open, or on ready for
 * review when it is a draft its instance does not generate.
 */
export function buildCappedCardDetail(
  t: TFunction,
  { prState, appInstalled, awaitsReadyForReview }: CappedCardDetailInput,
): string {
  const limit = t("pulls.capped.limit");
  if (!appInstalled) {
    return `${limit} ${t("pulls.capped.repasteNote")}`;
  }
  if (isNoLongerOpen(prState)) {
    return `${limit} ${t("pulls.failed.notOpenNote")}`;
  }
  if (awaitsReadyForReview) {
    return `${limit} ${t("pulls.capped.readyForReviewNote")}`;
  }
  return `${limit} ${t("pulls.capped.nextPush")}`;
}
