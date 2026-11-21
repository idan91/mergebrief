// What the PrBrief cards and the latest-push notice share about a Generate
// or Regenerate offer: the route's bar.
import { PrStates, type PrState } from "types";
import type { UnknownValue } from "@web/utils/open-enum/types";

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
