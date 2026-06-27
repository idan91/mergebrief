import { type ReactNode } from "react";
import { createPortal } from "react-dom";

import styles from "./Callout.module.scss";

function CalloutRoot({
  pos,
  children,
}: {
  pos: { top: number; left: number };
  children: ReactNode;
}) {
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

function CalloutEyebrow({ children }: { children: ReactNode }) {
  return <span className={styles["eyebrow"]}>{children}</span>;
}

function CalloutTitle({ children }: { children: ReactNode }) {
  return <span className={styles["title"]}>{children}</span>;
}

function CalloutBody({ children }: { children: ReactNode }) {
  return <span className={styles["body"]}>{children}</span>;
}

export const Callout = Object.assign(CalloutRoot, {
  Eyebrow: CalloutEyebrow,
  Title: CalloutTitle,
  Body: CalloutBody,
});
