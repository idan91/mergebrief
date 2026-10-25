/**
 * The cap counts a UTC calendar day, so it resets at the first midnight UTC
 * strictly after the skip was recorded. Derived from the SKIP time, never
 * from "now": a capped row left over from an earlier day must not claim to
 * be waiting on tonight.
 */
import type { TFunction } from "i18next";

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
