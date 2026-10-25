import { PrStates, type PrState } from "types";
import type { UnknownValue } from "@web/utils/open-enum/types";

import { SupersededStops, type PrSummary, type SupersededStop } from "../types";
import { awaitsReadyForReview } from "./draft-policy";

/** The PR-meta fields the superseded stop reads. */
export type SupersededStopSource = Pick<
  PrSummary,
  "state" | "appInstalled" | "draft" | "draftPolicy"
>;

/** A closed or merged PR; a state this bundle does not know stays neutral. */
export function isNoLongerOpen(prState: PrState | UnknownValue): boolean {
  return prState === PrStates.CLOSED || prState === PrStates.MERGED;
}

/**
 * Why a superseded row has nothing coming after it, or `undefined` while a
 * newer push is on its way. An installation run on a closed PR stands down
 * as superseded, and a draft's newer push under a drafts-off instance only
 * records state. A url row never stops: it supersedes only when its head
 * moved, and the worker queues that head.
 */
export function readSupersededStop(
  meta: SupersededStopSource,
): SupersededStop | undefined {
  if (!meta.appInstalled) {
    return undefined;
  }
  if (isNoLongerOpen(meta.state)) {
    return SupersededStops.CLOSED;
  }
  if (awaitsReadyForReview(meta)) {
    return SupersededStops.READY_FOR_REVIEW;
  }
  return undefined;
}
