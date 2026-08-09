import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import clsx from "clsx";
import styles from "./Modal.module.scss";

// Focusable elements inside the dialog box, for the Tab trap. `aria-disabled`
// controls are deliberately NOT excluded — they stay focusable so they keep
// announcing why they are off.
const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export interface ModalProps {
  open: boolean;
  boxClassName?: string | undefined;
  /**
   * @description id of the element that names this dialog (its heading),
   * wired to `aria-labelledby` — without it the dialog announces nameless.
   */
  labelledBy: string;
  /**
   * @description Dismiss handler. When provided, Escape closes the modal.
   */
  close?: (() => void) | undefined;
  children: ReactNode;
}

export function Modal({
  open,
  boxClassName,
  labelledBy,
  close,
  children,
}: ModalProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  // Move focus into the dialog on open; return it to the trigger on close.
  // The return is a deferred FALLBACK: it runs a microtask after this commit's
  // effects, so a close path that re-homes focus itself always wins. Only
  // focus the close DROPPED (on <body>, where `inert` expels it) comes back;
  // focus stranded inside the closed box is left for the overlay's own rescue.
  useEffect(() => {
    if (!open) return;
    triggerRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    boxRef.current?.focus();
    return () => {
      const trigger = triggerRef.current;
      triggerRef.current = null;
      queueMicrotask(() => {
        const active = document.activeElement;
        const dropped = active === null || active === document.body;
        if (dropped && trigger !== null && trigger.isConnected) {
          trigger.focus();
        }
      });
    };
  }, [open]);

  // Escape-to-close, split from focus management so a `close` identity change
  // never re-runs the focus effect (which would re-capture a stale trigger
  // mid-dialog and "return" focus while the modal is still open).
  useEffect(() => {
    if (!open || !close) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  // Tab trap: focus cycles inside the box while the modal is open — the page
  // behind it stays visually present but must be unreachable by keyboard.
  const onTrapKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") return;
    const nodes = boxRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!nodes || nodes.length === 0) {
      event.preventDefault();
      return;
    }
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    const active = document.activeElement;
    if (event.shiftKey && (active === first || active === boxRef.current)) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first?.focus();
    }
  };

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
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
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
