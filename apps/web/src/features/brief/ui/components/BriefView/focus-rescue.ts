import { MOBILE_QUERY } from "@web/hooks/useMobileViewport";
import { TERMINAL_SLOT_SELECTOR } from "./consts";
import type { ShownButtonRef } from "./hooks/usePhoneChrome";

/** Orphaned focus goes to the terminal-slot CTA, or on a phone to Brief controls. */
export function focusRescueTarget(phoneControlsRef: ShownButtonRef): void {
  const phoneControls = phoneControlsRef.current;
  const onPhone = window.matchMedia(MOBILE_QUERY).matches;
  const rescuesToPhoneControls = onPhone && phoneControls !== undefined;
  if (rescuesToPhoneControls) {
    phoneControls.focus();
    return;
  }
  document.querySelector<HTMLElement>(TERMINAL_SLOT_SELECTOR)?.focus();
}
