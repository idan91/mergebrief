import type { TFunction } from "i18next";
import type { PrState } from "types";
import type { UnknownValue } from "@web/utils/open-enum/types";
import { isNoLongerOpen } from "../../../utils/pr-state";

/** What decides whether the default "next push" promise holds. */
export interface EmptyCopyFacts {
  readonly appInstalled: boolean;
  readonly prState: PrState | UnknownValue;
  /** A draft under a drafts-off instance: only ready for review queues a run. */
  readonly awaitsReadyForReview: boolean;
  /** The draft's own author's drafts-off notice, when the viewer is the author. */
  readonly draftsOffNotice: string | undefined;
}

/**
 * The line replacing the default empty copy, which promises a run on the
 * next push. A closed or merged installation PR gets none, and a draft its
 * instance skips gets one only once marked ready for review, whoever views
 * it. A url row keeps the default: it names the App-installed repositories
 * its promise holds for.
 */
export function buildEmptyCopyOverride(
  t: TFunction,
  facts: EmptyCopyFacts,
): string | undefined {
  if (!facts.appInstalled) {
    return undefined;
  }
  if (isNoLongerOpen(facts.prState)) {
    return t("pulls.empty.notOpenCopy");
  }
  if (!facts.awaitsReadyForReview) {
    return undefined;
  }
  return facts.draftsOffNotice ?? t("pulls.empty.awaitsReadyCopy");
}
