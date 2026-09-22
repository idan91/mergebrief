import { useEffect, useState } from "react";

import { isInsideOverlay } from "../../../utils/overlay-target";
import { isTypingTarget } from "../../../utils/typingTarget";

const TOGGLE_KEY = "?";

/**
 * The Home shortcuts dialog: "?" toggles it from the page, or from inside
 * the dialog itself; a "?" typed into a field or pressed inside another
 * open menu is theirs. Disabled, it never opens and listens to nothing.
 */
export function useHomeShortcuts(enabled: boolean) {
  const [isOpen, setOpen] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
      return undefined;
    }
    function toggleOnKey(event: KeyboardEvent): void {
      if (event.key !== TOGGLE_KEY || event.metaKey || event.ctrlKey) return;
      if (isTypingTarget(event.target)) return;
      if (isInsideOverlay(event.target) && !isOpen) return;
      event.preventDefault();
      setOpen(!isOpen);
    }
    window.addEventListener("keydown", toggleOnKey);
    return () => window.removeEventListener("keydown", toggleOnKey);
  }, [enabled, isOpen]);

  return {
    isOpen,
    open: () => setOpen(true),
    close: () => setOpen(false),
  };
}
