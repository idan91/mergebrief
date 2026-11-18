import type { ReactNode } from "react";
import clsx from "clsx";

import styles from "./BarGroup.module.scss";

export interface BarGroupProps {
  /** The rows, in reading order; an absent row leaves no gap. */
  children: ReactNode;
  className?: string | undefined;
  testId?: string | undefined;
}

/** One surface holding a run of bars, a hairline between each. */
export function BarGroup({ children, className, testId }: BarGroupProps) {
  return (
    <div className={clsx(styles["group"], className)} data-testid={testId}>
      {children}
    </div>
  );
}
