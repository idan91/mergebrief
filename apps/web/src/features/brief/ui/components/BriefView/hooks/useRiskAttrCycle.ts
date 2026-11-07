import { useEffect } from "react";
import { useStore } from "zustand";

import type { BriefViewStore } from "../store";

export interface RiskAttrCycle {
  /** Each attribute's next carrying-group position, before the wrap. */
  positions: ReadonlyMap<string, number>;
  advance: (attr: string) => void;
}

/**
 * The risk attribute chips' cycle, shared by the toolbar and the phone sheet
 * so a sheet that closes on every jump still moves on. It starts over
 * whenever the toolbar region hides, as the toolbar's remount did.
 */
export function useRiskAttrCycle(
  viewStore: BriefViewStore,
  toolbarShown: boolean,
): RiskAttrCycle {
  const positions = useStore(viewStore, (state) => state.riskAttrCycle);
  const { advanceRiskAttrCycle, clearRiskAttrCycle } =
    viewStore.getState().actions;

  useEffect(() => {
    if (!toolbarShown) {
      clearRiskAttrCycle();
    }
  }, [clearRiskAttrCycle, toolbarShown]);

  return { positions, advance: advanceRiskAttrCycle };
}
