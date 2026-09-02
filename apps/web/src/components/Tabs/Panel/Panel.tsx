import clsx from "clsx";
import type { ReactNode } from "react";

import { useTabsContext } from "../context";
import { derivePanelId, deriveTabId } from "../utils";
import styles from "./Panel.module.scss";

export interface TabsPanelProps {
  value: string;
  children: ReactNode;
  className?: string | undefined;
}

export function TabsPanel({ value, children, className }: TabsPanelProps) {
  const { value: selectedValue, baseId } = useTabsContext();

  return (
    <div
      aria-labelledby={deriveTabId(baseId, value)}
      className={clsx(styles["panel"], className)}
      hidden={value !== selectedValue}
      id={derivePanelId(baseId, value)}
      role="tabpanel"
    >
      {children}
    </div>
  );
}
