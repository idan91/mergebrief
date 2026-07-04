import { type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";

import styles from "./Callout.module.scss";

interface CalloutRootProps {
  pos: { top: number; left: number };
  /**
   * Render a small arrow on the top edge, its tip `arrowX` px from the
   * callout's left edge — for anchoring the callout to the element it
   * annotates. Omit for the plain, arrowless callout.
   */
  arrowX?: number;
  /** Size to content instead of the fixed 320px column. */
  fit?: boolean;
  children: ReactNode;
}

/** CSSProperties plus the callout's own custom property (arrow anchor). */
type CalloutStyle = CSSProperties & { "--callout-arrow-x"?: string };

function CalloutRoot({ pos, arrowX, fit = false, children }: CalloutRootProps) {
  const style: CalloutStyle = {
    position: "fixed",
    top: pos.top,
    left: pos.left,
  };
  if (arrowX !== undefined) {
    style["--callout-arrow-x"] = `${arrowX}px`;
  }
  return createPortal(
    <span
      className={styles["callout"]}
      data-arrow={arrowX !== undefined ? "" : undefined}
      data-fit={fit ? "" : undefined}
      role="tooltip"
      style={style}
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
