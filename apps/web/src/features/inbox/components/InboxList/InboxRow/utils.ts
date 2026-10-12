import type { TFunction } from "i18next";

import { ReviewMarkLabelKeys } from "@web/components/ReviewMark/consts";
import { PullRequestSources } from "@web/features/pulls/types";
import { AgeUnits, type InboxGeneration, type InboxItem } from "../../../types";
import { formatAge } from "../../../utils";
import { readGenerationSignal, readStatusSignal } from "./RowEnd/utils";

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  day: "numeric",
  month: "short",
};

/** The title when it has text; a blank one falls back like a missing one. */
export function readRowTitle(title: string | undefined): string | undefined {
  if (title === undefined || title.trim() === "") {
    return undefined;
  }
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

/**
 * The row link's name before its title: review state, status, generation
 * state when a brief is on its way or failed, the source when it is a URL
 * row, and the author when it is someone else's. Icons are hidden, so this is what assistive technology reads.
 */
export function describeRow(
  t: TFunction,
  item: InboxItem,
  generation: InboxGeneration | undefined,
): string {
  const status = readStatusSignal(item.state, item.draft);
  const parts = [
    item.reviewState === undefined
      ? t("shell.marks.yours")
      : t(ReviewMarkLabelKeys[item.reviewState]),
    t(status?.label ?? "home.inbox.status.open"),
  ];
  const generationSignal = readGenerationSignal(generation);
  if (generationSignal !== null) {
    parts.push(t(generationSignal.label));
  }
  if (item.source === PullRequestSources.URL) {
    parts.push(t("home.inbox.sourceUrl"));
  }
  const otherAuthor = readOtherAuthor(item);
  if (otherAuthor !== undefined) {
    parts.push(t("home.inbox.byAuthor", { login: otherAuthor }));
  }
  return `${parts.join(". ")}.`;
}

/** The author a row names: absent on the viewer's own pull requests. */
export function readOtherAuthor(item: InboxItem): string | undefined {
  const otherAuthor = item.viewerIsAuthor ? undefined : item.authorLogin;
  return otherAuthor;
}
