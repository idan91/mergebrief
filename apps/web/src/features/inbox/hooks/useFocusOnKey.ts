import { useEffect, type RefObject } from "react";

import { isInsideOverlay } from "@web/utils/overlay-target";
import { isSuppressedSingleKey } from "@web/utils/single-key-shortcuts";
import { isTypingTarget } from "@web/utils/typingTarget";

/**
 * One key pressed on the page focuses a field, and selects its text when
 * asked to. A key typed into a field, pressed inside an open menu or with
 * single-key shortcuts off is left alone.
 */
export function useFocusOnKey(
  key: string,
  fieldRef: RefObject<HTMLInputElement | null>,
  selectsText = false,
): void {
  useEffect(() => {
    function focusOnKey(event: KeyboardEvent): void {
      if (event.key !== key || event.metaKey || event.ctrlKey) {
        return;
      }
      if (isTypingTarget(event.target) || isInsideOverlay(event.target)) {
        return;
      }
      if (isSuppressedSingleKey(event)) {
        return;
      }
      event.preventDefault();
      fieldRef.current?.focus();
      if (selectsText) {
        fieldRef.current?.select();
      }
    }
    window.addEventListener("keydown", focusOnKey);
    return () => window.removeEventListener("keydown", focusOnKey);
  }, [key, fieldRef, selectsText]);
}
