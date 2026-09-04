import { Children, Fragment, type ReactNode } from "react";
import clsx from "clsx";

import type { ValueOf } from "types";
import styles from "./Kbd.module.scss";

export const KbdSizes = {
  SM: "sm",
  MD: "md",
} as const;

export type KbdSize = ValueOf<typeof KbdSizes>;

export interface KbdProps {
  children: ReactNode;
  /** `md` for a shortcuts list; `sm` for a key named inside a sentence. */
  size?: KbdSize;
  className?: string | undefined;
}

/**
 * @description A key cap with a physical-key face: bevelled, so a chord
 * reads as separate keys and a hint in a sentence still recedes.
 */
export function Kbd({ children, size = KbdSizes.MD, className }: KbdProps) {
  return (
    <kbd className={clsx(styles["kbd"], className)} data-size={size}>
      {children}
    </kbd>
  );
}

export interface KbdGroupProps {
  children: ReactNode;
  className?: string | undefined;
}

/**
 * @description Lays chord members out as separate caps with a plus between
 * them, matching how a physical shortcut is written.
 */
export function KbdGroup({ children, className }: KbdGroupProps) {
  const caps = Children.toArray(children);

  return (
    <span className={clsx(styles["group"], className)}>
      {caps.map((cap, index) => (
        <Fragment key={index}>
          {index > 0 ? <span className={styles["join"]}>+</span> : null}
          {cap}
        </Fragment>
      ))}
    </span>
  );
}
