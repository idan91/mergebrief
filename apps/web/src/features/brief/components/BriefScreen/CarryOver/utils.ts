import type { TFunction } from "i18next";

import { getShortSha } from "../../../utils/short-sha";

/**
 * The span the row always states. The revision count is suppressed when both
 * ends are the same SHA: `revisions` counts BRIEFED revisions, so a re-brief
 * of the same head would otherwise read as pushes that never happened.
 */
export function getSpanLabel(
  t: TFunction,
  from: string,
  to: string,
  revisions: number,
): string {
  const ends = { from: getShortSha(from), to: getShortSha(to) };
  if (from === to || revisions <= 1) {
    return t("brief.carryOver.span", ends);
  }
  return t("brief.carryOver.spanRevisions", { ...ends, count: revisions });
}
