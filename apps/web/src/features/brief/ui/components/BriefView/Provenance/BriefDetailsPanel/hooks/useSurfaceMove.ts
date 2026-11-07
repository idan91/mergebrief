import { useRef, useState } from "react";

import { CALLOUT_ROOT_SELECTOR } from "@web/components/Callout/consts";
import {
  DetailsSurfaces,
  type DetailsSurface,
  type SurfaceMove,
} from "../types";

export function useSurfaceMove(
  surfaceId: string,
  chipEl: HTMLButtonElement | null,
  triggerEl: HTMLButtonElement | null,
): SurfaceMove {
  const [openSurface, setOpenSurface] = useState<DetailsSurface | undefined>();
  // A click or Enter pins the surface it opens, and a hover never replaces a
  // pinned one. A mouse hovers before it clicks, so a click on the chip's own
  // preview pins it and only a click on pinned warnings collapses them; the ⓘ
  // toggles on every click.
  const pinned = useRef(false);
  // One mousemove enters the next trigger before the last one's leave closes
  // its surface, so both read the surface moved to, not the rendered one.
  const latestSurface = useRef<DetailsSurface | undefined>(undefined);

  // Focus inside the portal would drop to <body> when the surface unmounts,
  // so it goes home to the trigger of the surface it leaves or lands on,
  // without scrolling: an outside press closes mid-press, and a jump would
  // move the page under the pointer before its click lands.
  const moveTo = (next: DetailsSurface | undefined) => {
    const callout = document
      .getElementById(surfaceId)
      ?.closest(CALLOUT_ROOT_SELECTOR);
    const focusWasInside = callout?.contains(document.activeElement) ?? false;
    const home =
      (next ?? latestSurface.current) === DetailsSurfaces.WARNINGS
        ? chipEl
        : triggerEl;
    pinned.current = false;
    latestSurface.current = next;
    setOpenSurface(next);
    if (focusWasInside) {
      home?.focus({ preventScroll: true });
    }
  };

  return {
    openSurface,
    moveTo,
    pinOpen: () => {
      pinned.current = true;
    },
    isPinned: () => pinned.current,
    getLatestSurface: () => latestSurface.current,
  };
}
