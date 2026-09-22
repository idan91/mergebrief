import type { TFunction } from "i18next";

import { AgeUnits } from "../../../types";
import { formatAge } from "../../../utils";

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
};

/** The title when it has text; a blank one falls back like a missing one. */
export function readRowTitle(title: string | null): string | undefined {
  if (title === null || title.trim() === "") return undefined;
  return title;
}

/** The age a row prints: relative under two weeks, a short date past that. */
export function formatAgeLabel(t: TFunction, at: string, now: Date): string {
  const age = formatAge(at, now);
  switch (age.unit) {
    case AgeUnits.MINUTES:
      return t("home.inbox.ageMinutes", { count: age.count });
    case AgeUnits.HOURS:
      return t("home.inbox.ageHours", { count: age.count });
    case AgeUnits.YESTERDAY:
      return t("home.inbox.ageYesterday");
    case AgeUnits.DAYS:
      return t("home.inbox.ageDays", { count: age.count });
    case AgeUnits.DATE:
      return new Date(at).toLocaleDateString(undefined, DATE_FORMAT);
  }
}
