import type { useInteractions } from "@floating-ui/react";
import { createContext, useContext } from "react";

export interface MenuContextValue {
  readonly activeIndex: number | null;
  readonly getItemProps: ReturnType<typeof useInteractions>["getItemProps"];
  readonly close: () => void;
}

export const MenuContext = createContext<MenuContextValue | null>(null);

export function useMenuContext(): MenuContextValue {
  const value = useContext(MenuContext);
  if (value === null) throw new Error("MenuRow renders inside a Menu");
  return value;
}
