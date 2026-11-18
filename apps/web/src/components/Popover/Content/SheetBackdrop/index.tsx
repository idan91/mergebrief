import type { RefObject } from "react";

import { useBodyScrollLock } from "@web/hooks/useBodyScrollLock";
import styles from "./SheetBackdrop.module.scss";

export interface SheetBackdropProps {
  scrimRef: RefObject<HTMLDivElement | null>;
  close: () => void;
}

/** The scrim behind a Popover in sheet mode; it locks the page while mounted. */
export function SheetBackdrop({ scrimRef, close }: SheetBackdropProps) {
  useBodyScrollLock(true);
  return (
    // The panel's Escape and its trigger are the keyboard's way out; this is the pointer's.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      aria-hidden="true"
      className={styles["scrim"]}
      ref={scrimRef}
      onClick={close}
    />
  );
}
