import type { TFunction } from "i18next";
import type { PrState } from "types";
import type { UnknownValue } from "@web/utils/open-enum/types";
import { isNoLongerOpen } from "../../../utils/pr-state";

/** What decides whether the default "next push" promise holds. */
export interface EmptyCopyFacts {
  readonly appInstalled: boolean;
  readonly prState: PrState | UnknownValue;
}

/**
 * The line replacing the default empty copy, which promises a run on the
 * next push. A closed or merged installation PR gets none. A url row keeps
 * the default: it names the App-installed repositories its promise holds for.
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
  return undefined;
}
