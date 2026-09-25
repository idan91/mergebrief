import { useInteractions } from "@floating-ui/react";
import { useMemo, type ReactNode } from "react";

import { PopoverContent } from "./Content/Content";
import { PopoverContext, type PopoverContextValue } from "./context";
import { PopoverTrigger } from "./Trigger/Trigger";
import { usePopover, type PopoverOptions } from "./usePopover";

export interface PopoverProps extends PopoverOptions {
  /** One `Popover.Trigger` and one `Popover.Content`. */
  children: ReactNode;
}

/**
 * A panel that opens on click beside its trigger: `Popover.Trigger` wraps
 * the one element that opens it, `Popover.Content` holds what opens.
 * Escape closes it and returns focus to the trigger; an outside press or a
 * Tab out closes it and leaves focus where it went.
 */
function PopoverRoot({ children, ...options }: PopoverProps) {
  const popover = usePopover(options);
  const { getReferenceProps, getFloatingProps } = useInteractions(
    popover.interactions,
  );
  const value = useMemo<PopoverContextValue>(
    () => ({ ...popover, getReferenceProps, getFloatingProps }),
    [popover, getReferenceProps, getFloatingProps],
  );

  return (
    <PopoverContext.Provider value={value}>{children}</PopoverContext.Provider>
  );
}

export const Popover = Object.assign(PopoverRoot, {
  Trigger: PopoverTrigger,
  Content: PopoverContent,
});
