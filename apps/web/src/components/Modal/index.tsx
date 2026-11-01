import { useEffect, useRef, type ReactNode, type RefObject } from "react";
import clsx from "clsx";

import { useFocusTrap } from "../../hooks/useFocusTrap";
import styles from "./Modal.module.scss";

export interface ModalProps {
  open: boolean;
  boxClassName?: string | undefined;
  /**
   * @description id of the element that names this dialog (its heading),
   * wired to `aria-labelledby`; without it the dialog announces nameless.
   */
  labelledBy: string;
  /**
   * @description Dismiss handler. When provided, Escape closes the modal.
   */
  close?: (() => void) | undefined;
  /**
   * @description The one control focus lands on when the dialog opens: a
   * dialog with one obvious first field names it, any other lands on the box.
   */
  initialFocus?: RefObject<HTMLElement | null> | undefined;
  /**
   * @description The control that opened the dialog, which focus returns to
   * on close. Safari never focuses a clicked button, so a dialog a click
   * opens names it; absent, the element focused at open is used.
   */
  opener?: HTMLElement | undefined;
  children: ReactNode;
}

export function Modal({
  open,
  boxClassName,
  labelledBy,
  close,
  initialFocus,
  opener,
  children,
}: ModalProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const latestInitialFocus = useRef(initialFocus);
  const latestOpener = useRef(opener);

  // Read through refs so a caller handing a fresh ref object mid-dialog
  // never re-runs the focus effect and re-captures a stale trigger.
  useEffect(() => {
    latestInitialFocus.current = initialFocus;
    latestOpener.current = opener;
  });

  // Move focus into the dialog on open; return it to the trigger on close.
  // The return is a deferred FALLBACK: it runs a microtask after this commit's
  // effects, so a close path that re-homes focus elsewhere always wins. Focus
  // the close DROPPED (on <body>) or left inside the closed box comes back;
  // a browser expels the latter to <body> only later, past this microtask.
  useEffect(() => {
    if (!open) {
      return;
    }
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    triggerRef.current = latestOpener.current ?? focused;
    const box = boxRef.current;
    const target = latestInitialFocus.current?.current ?? box;
    target?.focus();
    // A menu row that opened this dialog leaves a focus queued on the next
    // frame for its leaving panel; reclaiming after it keeps the landing.
    const reclaim = window.requestAnimationFrame(() => {
      if (box !== null && !box.contains(document.activeElement)) {
        target?.focus();
      }
    });
    return () => {
      window.cancelAnimationFrame(reclaim);
      const trigger = triggerRef.current;
      triggerRef.current = null;
      queueMicrotask(() => {
        const active = document.activeElement;
        const dropped = active === null || active === document.body;
        const inside = active !== null && box?.contains(active);
        if ((dropped || inside) && trigger !== null && trigger.isConnected) {
          trigger.focus();
        }
      });
    };
  }, [open]);

  // Escape-to-close, split from focus management so a `close` identity change
  // never re-runs the focus effect (which would re-capture a stale trigger
  // mid-dialog and "return" focus while the modal is still open).
  useEffect(() => {
    if (!open || !close) {
      return;
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        close();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  const onTrapKeyDown = useFocusTrap(boxRef);

  return (
    <div
      className={styles["modal"]}
      data-state={open ? "open" : "closed"}
      // Closed modal is display:none, but keep it out of the a11y tree and tab
      // order explicitly too.
      inert={!open}
    >
      {/* The keydown is the dialog's Tab TRAP, not an interactive behavior:
          the box only steers focus among the real controls inside it. */}
      {/* oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <div
        className={clsx(styles["box"], boxClassName)}
        ref={boxRef}
        aria-labelledby={labelledBy}
        aria-modal="true"
        role="dialog"
        tabIndex={-1}
        onKeyDown={onTrapKeyDown}
      >
        {children}
      </div>
    </div>
  );
}
