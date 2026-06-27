import { type ReactNode } from "react";
import { createPortal } from "react-dom";

import styles from "./Callout.module.scss";

interface CalloutProps {
  pos: { top: number; left: number };
  children: ReactNode;
}

export function Callout({ pos, children }: CalloutProps) {
  return createPortal(
    <span
      className={styles["callout"]}
      role="tooltip"
      style={{ position: "fixed", top: pos.top, left: pos.left }}
    >
      {children}
    </span>,
    document.body,
  );
}

export function CalloutEyebrow({ children }: { children: ReactNode }) {
  return <span className={styles["eyebrow"]}>{children}</span>;
}

export function CalloutTitle({ children }: { children: ReactNode }) {
  return <span className={styles["title"]}>{children}</span>;
}

export function CalloutBody({
  children,
  unavailable,
}: {
  children: ReactNode;
  unavailable?: boolean;
}) {
  return (
    <span
      className={`${styles["body"]}${unavailable ? ` ${styles["unavailable"]}` : ""}`}
    >
      {children}
    </span>
  );
}
