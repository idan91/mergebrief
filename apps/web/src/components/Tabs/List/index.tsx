import type { ReactNode } from "react";

import { useMobileViewport } from "@web/hooks/useMobileViewport";
import { useTabsContext } from "../context";
import { TabsVariants } from "../types";
import styles from "./List.module.scss";

export interface TabsListProps {
  label: string;
  children: ReactNode;
}

export function TabsList({ label, children }: TabsListProps) {
  const { variant } = useTabsContext();
  const mobile = useMobileViewport();
  const railStands = variant === TabsVariants.RAIL && !mobile;
  const orientation = railStands ? "vertical" : "horizontal";

  return (
    <div
      aria-label={label}
      aria-orientation={orientation}
      className={styles["list"]}
      data-variant={variant}
      role="tablist"
    >
      {children}
    </div>
  );
}
