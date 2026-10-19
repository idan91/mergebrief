import clsx from "clsx";
import { useId, useMemo, type ReactNode } from "react";

import { TabsContext, type TabsContextValue } from "./context";
import { TabsList } from "./List";
import { TabsPanel } from "./Panel";
import { TabsTab } from "./Tab";
import styles from "./Tabs.module.scss";
import { TabsVariants, type TabsVariant } from "./types";

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string | undefined;
  /** A rail sits beside its panel and stacks its tabs; default the row. */
  variant?: TabsVariant;
}

/** Controlled WAI-ARIA tabs: `Tabs.List` of `Tabs.Tab`s, one `Tabs.Panel` per value. */
function TabsRoot({
  value,
  onValueChange,
  children,
  className,
  variant = TabsVariants.UNDERLINE,
}: TabsProps) {
  const baseId = useId();
  const context = useMemo<TabsContextValue>(
    () => ({ value, baseId, select: onValueChange, variant }),
    [value, baseId, onValueChange, variant],
  );

  return (
    <TabsContext.Provider value={context}>
      <div className={clsx(styles["root"], className)} data-variant={variant}>
        {children}
      </div>
    </TabsContext.Provider>
  );
}

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Tab: TabsTab,
  Panel: TabsPanel,
});
