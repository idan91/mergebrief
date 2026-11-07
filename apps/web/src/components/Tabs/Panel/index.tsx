import clsx from "clsx";
import type { ReactNode } from "react";

import { useTabsContext } from "../context";
import { derivePanelId, deriveTabId } from "../utils";
import styles from "./Panel.module.scss";

export interface TabsPanelProps {
  value: string;
  children: ReactNode;
  className?: string | undefined;
  /** A panel of text alone is its own tab stop, so a keyboard can reach and scroll it. */
  focusable?: boolean;
}

export function TabsPanel({
  value,
  children,
  className,
  focusable,
}: TabsPanelProps) {
  const { value: selectedValue, baseId } = useTabsContext();

  return (
    <div
      aria-labelledby={deriveTabId(baseId, value)}
      className={clsx(styles["panel"], className)}
      hidden={value !== selectedValue}
      id={derivePanelId(baseId, value)}
      role="tabpanel"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- the APG tabs pattern makes a content-only panel the tab stop
      tabIndex={focusable ? 0 : undefined}
    >
      {children}
    </div>
  );
}
