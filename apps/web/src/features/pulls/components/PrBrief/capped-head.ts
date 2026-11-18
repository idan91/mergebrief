/**
 * The cap counts a UTC calendar day, so it resets at the first midnight UTC
 * strictly after the skip was recorded. Derived from the SKIP time, never
 * from "now": a capped row left over from an earlier day must not claim to
 * be waiting on tonight.
 */
import type { TFunction } from "i18next";
import type { GenerationUnitsParams } from "types/generations";
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

/** When the cap that skipped a head resets, and whether that has passed. */
export interface CapReset {
  readonly resetsAt: Date;
  /** The window rolled over: the cap holds nothing back any more. */
  readonly passed: boolean;
}

/** Absent for an unreadable skip time. */
export function readCapReset(
  cappedAtIso: string,
  now: Date,
): CapReset | undefined {
  const resetsAt = readCapResetsAt(cappedAtIso);
  if (resetsAt === undefined) {
    return undefined;
  }
  const passed = resetsAt.getTime() <= now.getTime();
  return { resetsAt, passed };
}

export interface CappedLabelInput {
  /** When the skip was recorded (the projection row's `updatedAt`). */
  readonly cappedAt: string;
  /** A large run's refusal: the heading names the runs, never a reached cap. */
  readonly units?: GenerationUnitsParams | undefined;
}

/**
 * The capped heading. The reset time renders in the VIEWER's zone (the
 * operator's UTC boundary is an implementation detail). An unparsable
 * timestamp degrades to the capless sentence rather than printing
 * "Invalid Date", a reset that passed promises no future resume, and a run
 * no day fits promises none at all.
 */
export function buildCappedLabel(
  t: TFunction,
  { cappedAt, units }: CappedLabelInput,
  now: Date = new Date(),
): string {
  if (units !== undefined && isPastDailyCap(units)) {
    return t("pulls.capped.unitsOverCap");
  }
  const lackedRuns = units !== undefined;
  const reset = readCapReset(cappedAt, now);
  if (reset === undefined) {
    return lackedRuns
      ? t("pulls.capped.unitsShort")
      : t("pulls.capped.reached");
  }
  if (reset.passed) {
    return lackedRuns
      ? t("pulls.capped.unitsShortResumed")
      : t("pulls.capped.resumed");
  }
  // The template's datetime formatter renders in the ACTIVE locale.
  const params = { resetsAt: reset.resetsAt };
  return lackedRuns
    ? t("pulls.capped.unitsShortResumes", params)
    : t("pulls.capped.resumes", params);
}

export interface CappedCardDetailInput {
  readonly prState: PrSummary["state"];
  readonly appInstalled: boolean;
  /** A draft under a drafts-off instance: its next push queues nothing. */
  readonly awaitsReadyForReview: boolean;
  /** A large run's refusal: named in place of the instance's limit. */
  readonly units?: GenerationUnitsParams | undefined;
}

/**
 * What the cap is and how this head gets a brief. A capped head never reruns
 * on its own: a url row reruns on a paste whatever its state, an
 * installation row on its next push while the PR is open, or on ready for
 * review when it is a draft its instance does not generate.
 */
export function buildCappedCardDetail(
  t: TFunction,
  { prState, appInstalled, awaitsReadyForReview, units }: CappedCardDetailInput,
): string {
  if (units !== undefined && isPastDailyCap(units)) {
    const closed = appInstalled && isNoLongerOpen(prState);
    return buildPastCapDetail(t, units, closed);
  }
  const limit =
    units === undefined
      ? t("pulls.capped.limit")
      : t("pulls.capped.needsUnits", { count: units.needed, left: units.left });
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

/** No day's cap leaves room for the units a refused large run needed. */
export function isPastDailyCap(units: GenerationUnitsParams): boolean {
  return units.needed >= units.cap;
}

/** Only a raised cap briefs this pull request, so no push or paste is promised. */
function buildPastCapDetail(
  t: TFunction,
  units: GenerationUnitsParams,
  closed: boolean,
): string {
  const need = t("pulls.capped.overCapUnits", {
    count: units.needed,
    cap: units.cap,
  });
  if (closed) {
    return `${need} ${t("pulls.failed.notOpenNote")}`;
  }
  return `${need} ${t("pulls.capped.overCapNote")}`;
}
