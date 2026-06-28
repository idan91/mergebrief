import { useEffect, useRef, type ReactNode } from "react";
import clsx from "clsx";
import styles from "./Modal.module.scss";

export interface ModalProps {
  open: boolean;
  boxClassName?: string | undefined;
  /**
   * @description Dismiss handler. When provided, Escape closes the modal.
   */
  close?: (() => void) | undefined;
  children: ReactNode;
}

export function Modal({ open, boxClassName, close, children }: ModalProps) {
  const boxRef = useRef<HTMLDivElement | null>(null);

  // Move focus into the dialog on open and wire Escape-to-close, so the modal
  // is operable and dismissable from the keyboard.
  useEffect(() => {
    if (!open) return;
    boxRef.current?.focus();
    if (!close) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, close]);

  return (
    <div
      className={styles["modal"]}
      data-state={open ? "open" : "closed"}
      // Closed modal is display:none, but keep it out of the a11y tree and tab
      // order explicitly too.
      inert={!open}
    >
      <div
        className={clsx(styles["box"], boxClassName)}
        ref={boxRef}
        aria-modal="true"
        role="dialog"
        tabIndex={-1}
      >
        {children}
      </div>
    </div>
  );
}
