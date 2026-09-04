import clsx from "clsx";
import type { ReactNode } from "react";

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
 * @description A key cap with a physical-key face: bevelled, dim label, so a
 * hint recedes and the real buttons beside it carry the contrast.
 */
export function Kbd({ children, size = KbdSizes.MD, className }: KbdProps) {
  return (
    <kbd className={clsx(styles["kbd"], className)} data-size={size}>
      {children}
    </kbd>
  );
}
