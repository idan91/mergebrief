import { useEffect, useRef, useState, type RefObject } from "react";

import {
  LANDSCAPE_PHONE_QUERY,
  readLandscapePhone,
  useMobileViewport,
} from "@web/hooks/useMobileViewport";
import { focusRescueTarget } from "../focus-rescue";

type ButtonRef = RefObject<HTMLButtonElement | null>;

/**
 * Reads the button CSS shows at the moment of asking. `undefined` rather than
 * `null` while none is mounted keeps it off `RefObject`, so `ref=` refuses it
 * instead of throwing on its getter at mount.
 */
export interface ShownButtonRef {
  readonly current: HTMLButtonElement | undefined;
}

export interface PhoneChrome {
  controlsOpen: boolean;
  openControls: () => void;
  /** Closes the sheet and hands focus back to the controls button on screen. */
  closeControls: () => void;
  /** The upright bar's controls button. */
  barControlsRef: ButtonRef;
  /** The upright bar's indicator. */
  barIndicatorRef: ButtonRef;
  /** The sideways row's controls button. */
  rowControlsRef: ButtonRef;
  /** The sideways row's indicator. */
  rowIndicatorRef: ButtonRef;
  /** The indicator on screen, bar or row: the Sidebar sheet's trigger, which takes focus back from it. */
  sheetTriggerRef: ShownButtonRef;
  /** The controls button on screen, bar or row: where a focus rescue lands on a phone. */
  controlsRef: ShownButtonRef;
}

/** The bar and the row both render and CSS shows one; this answers which, at the moment of asking. */
function pickShownRef(barRef: ButtonRef, rowRef: ButtonRef): ButtonRef {
  return readLandscapePhone() ? rowRef : barRef;
}

/** The buttons a turn carries focus between: the indicators, then the controls on screen. */
interface RotationFocusRefs {
  indicatorRefs: readonly ButtonRef[];
  sheetTriggerRef: ShownButtonRef;
  controlsRef: ShownButtonRef;
}

/**
 * A turn hides the bar or the row through CSS, and a control there that held
 * focus would drop it to the page. Focus moves to the indicator on screen if
 * an indicator held it, else to the controls button on screen.
 */
function useRotationFocus(refs: RotationFocusRefs): void {
  const { indicatorRefs, sheetTriggerRef, controlsRef } = refs;

  useEffect(() => {
    const carryFocus = () => {
      const focused = document.activeElement;
      const heldControl =
        focused instanceof HTMLElement && focused !== document.body;
      if (!heldControl) {
        return;
      }
      const stillShown = focused.getClientRects().length > 0;
      if (stillShown) {
        return;
      }

      const heldIndicator = indicatorRefs.some(
        (ref) => ref.current === focused,
      );
      const target = heldIndicator ? sheetTriggerRef : controlsRef;
      target.current?.focus();
    };

    const query = window.matchMedia(LANDSCAPE_PHONE_QUERY);
    query.addEventListener("change", carryFocus);
    return () => query.removeEventListener("change", carryFocus);
  }, [indicatorRefs, sheetTriggerRef, controlsRef]);
}

/**
 * The Brief controls sheet's open state and the bar and row controls focus
 * returns to. The sheet closes when the viewport stops being a phone, since
 * its trigger is gone and the page shows the same controls in place, and
 * when the brief changes under it, since it describes the one it opened on.
 * Focus the sheet held lands on the terminal-slot CTA, or on a phone on the
 * Brief controls button on screen.
 */
export function usePhoneChrome(briefId: string): PhoneChrome {
  const mobile = useMobileViewport();
  // Tagged with the brief it opened on, so another brief reads it closed.
  const [controlsOpenFor, setControlsOpenFor] = useState<string | undefined>(
    undefined,
  );
  const controlsOpen = controlsOpenFor === briefId;
  const barControlsRef = useRef<HTMLButtonElement | null>(null);
  const barIndicatorRef = useRef<HTMLButtonElement | null>(null);
  const rowControlsRef = useRef<HTMLButtonElement | null>(null);
  const rowIndicatorRef = useRef<HTMLButtonElement | null>(null);
  const [sheetTriggerRef] = useState<ShownButtonRef>(() => ({
    get current() {
      return (
        pickShownRef(barIndicatorRef, rowIndicatorRef).current ?? undefined
      );
    },
  }));
  const [controlsRef] = useState<ShownButtonRef>(() => ({
    get current() {
      return pickShownRef(barControlsRef, rowControlsRef).current ?? undefined;
    },
  }));
  const [indicatorRefs] = useState(() => [barIndicatorRef, rowIndicatorRef]);
  useRotationFocus({ indicatorRefs, sheetTriggerRef, controlsRef });
  const [focusRescuePending, setFocusRescuePending] = useState(false);
  const sheetOrphaned = controlsOpen && !mobile;
  if (sheetOrphaned) {
    setControlsOpenFor(undefined);
    setFocusRescuePending(true);
  }

  // A tag left by the brief before reads closed already; clearing it keeps a
  // return to that brief closed, and the focus its sheet held is rescued.
  const controlsLeftOnEarlierBrief =
    controlsOpenFor !== undefined && controlsOpenFor !== briefId;
  useEffect(() => {
    if (!controlsLeftOnEarlierBrief) {
      return;
    }
    setControlsOpenFor(undefined);
    if (isFocusStranded()) {
      focusRescueTarget(controlsRef);
    }
  }, [controlsLeftOnEarlierBrief, controlsRef]);

  useEffect(() => {
    if (!focusRescuePending) {
      return;
    }
    setFocusRescuePending(false);
    if (isFocusStranded()) {
      focusRescueTarget(controlsRef);
    }
  }, [focusRescuePending, controlsRef]);

  const openControls = () => setControlsOpenFor(briefId);
  const closeControls = () => {
    setControlsOpenFor(undefined);
    pickShownRef(barControlsRef, rowControlsRef).current?.focus();
  };

  return {
    controlsOpen,
    openControls,
    closeControls,
    barControlsRef,
    barIndicatorRef,
    rowControlsRef,
    rowIndicatorRef,
    sheetTriggerRef,
    controlsRef,
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
