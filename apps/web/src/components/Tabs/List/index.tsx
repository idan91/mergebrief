import clsx from "clsx";
import type { ReactNode } from "react";

import { useMobileViewport } from "@web/hooks/useMobileViewport";
import { useTabsContext } from "../context";
import { TabsVariants } from "../types";
import styles from "./List.module.scss";

export interface TabsListProps {
  label: string;
  children: ReactNode;
  className?: string | undefined;
}

export function TabsList({ label, children, className }: TabsListProps) {
  const { variant } = useTabsContext();
  const mobile = useMobileViewport();
  const railStands = variant === TabsVariants.RAIL && !mobile;
  const orientation = railStands ? "vertical" : "horizontal";

  return (
    <div
      aria-label={label}
      aria-orientation={orientation}
      className={clsx(styles["list"], className)}
      data-variant={variant}
      role="tablist"
    >
      {children}
    </div>
  );
}
