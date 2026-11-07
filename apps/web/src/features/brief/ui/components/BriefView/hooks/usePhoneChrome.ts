import { useEffect, useRef, useState, type RefObject } from "react";

import { useMobileViewport } from "@web/hooks/useMobileViewport";
import { focusRescueTarget } from "../focus-rescue";

export interface PhoneChrome {
  controlsOpen: boolean;
  openControls: () => void;
  /** Closes the sheet and hands focus back to the bar's controls button. */
  closeControls: () => void;
  controlsRef: RefObject<HTMLButtonElement | null>;
  /** The bar's indicator: the Sidebar sheet's trigger, which takes focus back from it. */
  indicatorRef: RefObject<HTMLButtonElement | null>;
}

/**
 * The Brief controls sheet's open state and the two bar controls focus
 * returns to. The sheet closes when the viewport stops being a phone, since
 * its trigger is gone and the page shows the same controls in place, and
 * when the brief changes under it, since it describes the one it opened on.
 * Focus the sheet held lands on the terminal-slot CTA, or on a phone on the
 * Brief controls button.
 */
export function usePhoneChrome(briefId: string): PhoneChrome {
  const mobile = useMobileViewport();
  const [controlsOpen, setControlsOpen] = useState(false);
  const [shownBriefId, setShownBriefId] = useState(briefId);
  const controlsRef = useRef<HTMLButtonElement | null>(null);
  const indicatorRef = useRef<HTMLButtonElement | null>(null);
  const [focusRescuePending, setFocusRescuePending] = useState(false);
  const briefChanged = shownBriefId !== briefId;
  if (briefChanged) {
    setShownBriefId(briefId);
  }
  const sheetOrphaned = !mobile || briefChanged;
  if (controlsOpen && sheetOrphaned) {
    setControlsOpen(false);
    setFocusRescuePending(true);
  }

  useEffect(() => {
    if (!focusRescuePending) {
      return;
    }
    setFocusRescuePending(false);
    if (isFocusStranded()) {
      focusRescueTarget(controlsRef);
    }
  }, [focusRescuePending]);

  const openControls = () => setControlsOpen(true);
  const closeControls = () => {
    setControlsOpen(false);
    controlsRef.current?.focus();
  };

  return {
    controlsOpen,
    openControls,
    closeControls,
    controlsRef,
    indicatorRef,
  };
}

/**
 * The sheet's unmount drops focus on the body, or on the main landmark where
 * a control inside it hands focus off as it leaves.
 */
function isFocusStranded(): boolean {
  const active = document.activeElement;
  const main = document.getElementById("main-content");
  const stranded = active === document.body || active === main;
  return stranded;
}
