import { PrStates, type PrState } from "types";
import type { UnknownValue } from "@web/utils/open-enum/types";

/** A closed or merged PR; a state this bundle does not know stays neutral. */
export function isNoLongerOpen(prState: PrState | UnknownValue): boolean {
  return prState === PrStates.CLOSED || prState === PrStates.MERGED;
}
