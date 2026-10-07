import { createContext, useContext } from "react";

export interface TabsContextValue {
  value: string;
  baseId: string;
  select: (value: string) => void;
}

export const TabsContext = createContext<TabsContextValue | null>(null);

export function useTabsContext(): TabsContextValue {
  const context = useContext(TabsContext);
  if (!context) {
    throw new Error("Tabs sub-components render inside <Tabs>");
  }
  return context;
}
