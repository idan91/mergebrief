import { useCallback, useEffect, useState } from "react";

import {
  ViewportBands,
  type ViewportBand,
} from "@web/hooks/useViewportBoundary";
import type { ReadingPositionStore } from "./readingPosition";
import type { FocusPanelControl } from "./types";

export interface FocusPanelOptions {
  position: ReadingPositionStore;
  focusMode: boolean;
  band: ViewportBand;
}

/**
 * On desktop the panel opens on entering focus mode and on entering any
 * group, returning to one included; a close holds only while the reader
 * stays in that group. Below the tablet breakpoint it is a modal sheet that
 * opens only on request, and crossing the breakpoint closes it while the
 * desktop choice waits unchanged.
 */
export function useFocusPanel({
  position,
  focusMode,
  band,
}: FocusPanelOptions): FocusPanelControl {
  const sheet = band === ViewportBands.NARROW;
  const [desktopOpen, setDesktopOpen] = useState(true);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [wasFocusMode, setWasFocusMode] = useState(focusMode);
  const [lastBand, setLastBand] = useState(band);
  if (focusMode !== wasFocusMode) {
    setWasFocusMode(focusMode);
    if (focusMode) {
      setDesktopOpen(true);
      setSheetOpen(false);
    }
  }
  if (band !== lastBand) {
    setLastBand(band);
    setSheetOpen(false);
  }

  useEffect(
    () =>
      position.subscribe((next, previous) => {
        if (next.activeGroupId !== previous.activeGroupId) {
          setDesktopOpen(true);
        }
      }),
    [position],
  );

  const setOpen = useCallback(
    (open: boolean) => (sheet ? setSheetOpen(open) : setDesktopOpen(open)),
    [sheet],
  );
  const toggle = useCallback(() => {
    const flip = (current: boolean) => !current;
    if (sheet) {
      setSheetOpen(flip);
    } else {
      setDesktopOpen(flip);
    }
  }, [sheet]);
  const close = useCallback(() => setOpen(false), [setOpen]);
  const open = sheet ? sheetOpen : desktopOpen;

  return { open, sheet, setOpen, toggle, close };
}
