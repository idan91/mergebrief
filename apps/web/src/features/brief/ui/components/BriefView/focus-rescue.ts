import type { RefObject } from "react";

import { MOBILE_QUERY } from "@web/hooks/useMobileViewport";
import { TERMINAL_SLOT_SELECTOR } from "./consts";

/** Orphaned focus goes to the terminal-slot CTA, or on a phone to Brief controls. */
export function focusRescueTarget(
  phoneControlsRef: RefObject<HTMLButtonElement | null>,
): void {
  const phoneControls = phoneControlsRef.current;
  const onPhone = window.matchMedia(MOBILE_QUERY).matches;
  if (onPhone && phoneControls !== null) {
    phoneControls.focus();
    return;
  }
  document.querySelector<HTMLElement>(TERMINAL_SLOT_SELECTOR)?.focus();
}
