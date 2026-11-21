// PROTOTYPE (BRIEF-381): the filter preview and the held rows, above the list.
import type { ReactNode } from "react";

import { FilterPreview } from "../FilterPreview";
import styles from "./HeldInboxBlock.module.scss";

export function HeldInboxBlock({ children }: { children: ReactNode }) {
  return (
    <div className={styles["block"]} data-testid="held-prototype-rows">
      <FilterPreview />
      {children}
    </div>
  );
}
