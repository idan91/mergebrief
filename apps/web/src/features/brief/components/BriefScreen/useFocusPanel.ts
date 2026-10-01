import { useCallback, useEffect, useState } from "react";

import type { ReadingPositionStore } from "./readingPosition";
import type { FocusPanelControl } from "./types";

export interface FocusPanelOptions {
  position: ReadingPositionStore;
  focusMode: boolean;
}

/**
 * Open on entering focus mode and on entering any group, returning to one
 * included; a close holds only while the reader stays in that group.
 */
export function useFocusPanel({
  position,
  focusMode,
}: FocusPanelOptions): FocusPanelControl {
  const [open, setOpen] = useState(true);
  const [wasFocusMode, setWasFocusMode] = useState(focusMode);
  if (focusMode !== wasFocusMode) {
    setWasFocusMode(focusMode);
    if (focusMode) {
      setOpen(true);
    }
  }

  useEffect(
    () =>
      position.subscribe((next, previous) => {
        if (next.activeGroupId !== previous.activeGroupId) {
          setOpen(true);
        }
      }),
    [position],
  );

  const toggle = useCallback(() => setOpen((current) => !current), []);
  const close = useCallback(() => setOpen(false), []);

  return { open, setOpen, toggle, close };
}
