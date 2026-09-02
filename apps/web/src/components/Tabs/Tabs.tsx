import clsx from "clsx";
import { useId, useMemo, type ReactNode } from "react";

import { TabsContext, type TabsContextValue } from "./context";
import { TabsList } from "./List/List";
import { TabsPanel } from "./Panel/Panel";
import { TabsTab } from "./Tab/Tab";
import styles from "./Tabs.module.scss";

export interface TabsProps {
  value: string;
  onValueChange: (value: string) => void;
  children: ReactNode;
  className?: string | undefined;
}

/** Controlled WAI-ARIA tabs: `Tabs.List` of `Tabs.Tab`s, one `Tabs.Panel` per value. */
function TabsRoot({ value, onValueChange, children, className }: TabsProps) {
  const baseId = useId();
  const context = useMemo<TabsContextValue>(
    () => ({ value, baseId, select: onValueChange }),
    [value, baseId, onValueChange],
  );

  return (
    <TabsContext.Provider value={context}>
      <div className={clsx(styles["root"], className)}>{children}</div>
    </TabsContext.Provider>
  );
}

export const Tabs = Object.assign(TabsRoot, {
  List: TabsList,
  Tab: TabsTab,
  Panel: TabsPanel,
});
