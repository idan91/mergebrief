import type { UseInteractionsReturn } from "@floating-ui/react";
import { createContext, useContext } from "react";

import type { PopoverState } from "./usePopover";

export type PopoverContextValue = Omit<PopoverState, "interactions"> &
  Pick<UseInteractionsReturn, "getReferenceProps" | "getFloatingProps">;

export const PopoverContext = createContext<PopoverContextValue | null>(null);

export function usePopoverContext(): PopoverContextValue {
  const value = useContext(PopoverContext);
  if (value === null) {
    throw new Error("Popover parts render inside a Popover root");
  }
  return value;
}
