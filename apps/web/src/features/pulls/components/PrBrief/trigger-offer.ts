// What the PrBrief cards and the latest-push notice share about a Generate
// or Regenerate offer: the route's bar and the Generate outcome copy.
import { PrStates, type PrState } from "types";
import type { UnknownValue } from "@web/utils/open-enum/types";

import { RegenerateResultKinds, type RegenerateNoticeKeys } from "../../types";

export interface TriggerOfferInput {
  readonly prState: PrState | UnknownValue;
  readonly viewerCanPush: boolean;
  readonly appInstalled: boolean;
}

/** The trigger route's own bar: an open PR, push access, and the App installed. */
export function readOffersTrigger({
  prState,
  viewerCanPush,
  appInstalled,
}: TriggerOfferInput): boolean {
  const open = prState === PrStates.OPEN;
  const offered = open && viewerCanPush && appInstalled;
  return offered;
}

/** A queued run swaps the card, and that swap is announced by the page. */
export const GenerateNotices: RegenerateNoticeKeys = {
  [RegenerateResultKinds.QUEUED]: undefined,
  [RegenerateResultKinds.HELD]: "pulls.briefError.generation-held",
  [RegenerateResultKinds.NOT_REGENERABLE]:
    "pulls.awaitingTrigger.generate.stale",
  [RegenerateResultKinds.NOT_ALLOWED]:
    "pulls.awaitingTrigger.generate.notAllowed",
  [RegenerateResultKinds.UNAUTHORIZED]:
    "pulls.awaitingTrigger.generate.unauthorized",
  [RegenerateResultKinds.UPSTREAM]: "pulls.awaitingTrigger.generate.upstream",
  [RegenerateResultKinds.INDETERMINATE]:
    "pulls.awaitingTrigger.generate.indeterminate",
};
