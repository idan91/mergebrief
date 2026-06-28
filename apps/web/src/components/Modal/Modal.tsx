import type { ReactNode } from "react";
import clsx from "clsx";
import styles from "./Modal.module.scss";

export interface ModalProps {
  open: boolean;
  boxClassName?: string | undefined;
  children: ReactNode;
}

export function Modal({ open, boxClassName, children }: ModalProps) {
  return (
    <div className={styles["modal"]} data-state={open ? "open" : "closed"}>
      <div className={clsx(styles["box"], boxClassName)}>{children}</div>
    </div>
  );
}
