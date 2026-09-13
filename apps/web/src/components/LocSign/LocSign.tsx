import type { ValueOf } from "types";

import styles from "./LocSign.module.scss";

export const LocSigns = {
  ADD: "add",
  DEL: "del",
} as const;
export type LocSignKind = ValueOf<typeof LocSigns>;

export interface LocSignProps {
  sign: LocSignKind;
  count: number;
}

const LocSignPrefixes = {
  [LocSigns.ADD]: "+",
  [LocSigns.DEL]: "−",
} as const;

export function LocSign({ sign, count }: LocSignProps) {
  const prefix = LocSignPrefixes[sign];
  return (
    <span className={styles["locSign"]} data-sign={sign}>
      {prefix}
      {count}
    </span>
  );
}
