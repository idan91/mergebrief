import { useEffect } from "react";

import { CALLOUT_ROOT_SELECTOR } from "@web/components/Callout/consts";

export function useOutsidePressToClose(
  open: boolean,
  surfaceId: string,
  anchorEl: HTMLElement | null,
  close: () => void,
): void {
  // A surface opened by keyboard or touch never gets a pointer leave, so a
  // press anywhere outside the anchor and the panel closes it.
  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node)) {
        return;
      }
      const panel = document
        .getElementById(surfaceId)
        ?.closest(CALLOUT_ROOT_SELECTOR);
      const onAnchor = anchorEl?.contains(event.target) ?? false;
      const onPanel = panel?.contains(event.target) ?? false;
      if (!onAnchor && !onPanel) {
        close();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    return () =>
      document.removeEventListener("pointerdown", onPointerDown, true);
  });
}
