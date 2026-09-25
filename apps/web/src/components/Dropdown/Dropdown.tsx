import { useInteractions, type ElementProps } from "@floating-ui/react";
import { useMemo, type ReactNode } from "react";

import { PopoverContext, type PopoverContextValue } from "../Popover/context";
import { PopoverTrigger } from "../Popover/Trigger/Trigger";
import { PopoverFocusTargets } from "../Popover/types";
import { usePopover, type PopoverOptions } from "../Popover/usePopover";
import { DropdownContent } from "./Content/Content";
import { DropdownContext, type DropdownContextValue } from "./context";
import { DropdownGroup } from "./Group/Group";
import { DropdownItem } from "./Item/Item";
import { DropdownLabel } from "./Label/Label";
import { DropdownSeparator } from "./Separator/Separator";
import {
  DropdownRoles,
  type DropdownMultipleSelection,
  type DropdownSingleSelection,
} from "./types";
import { useDropdownList } from "./useDropdownList";
import { readSelection } from "./utils";

type DropdownPopoverOptions = Omit<PopoverOptions, "focusOnOpen">;

export interface DropdownSingleProps
  extends DropdownPopoverOptions, DropdownSingleSelection {
  children: ReactNode;
}

export interface DropdownMultipleProps
  extends DropdownPopoverOptions, DropdownMultipleSelection {
  children: ReactNode;
}

export type DropdownProps = DropdownSingleProps | DropdownMultipleProps;

/**
 * The select: a listbox beside its trigger. One value closes on choice and
 * returns focus to the trigger; many keep the panel open and toggle. Arrows
 * wrap, Home and End jump, typing jumps to a label, Escape closes.
 */
function DropdownRoot(props: DropdownProps) {
  const popover = usePopover({
    placement: props.placement,
    offsetPx: props.offsetPx,
    portal: props.portal,
    focusOnOpen: PopoverFocusTargets.LIST,
  });
  const list = useDropdownList(popover.context, {
    role: DropdownRoles.LISTBOX,
  });
  const selection = readSelection(props);
  const multiselectable: ElementProps = {
    floating: { "aria-multiselectable": selection.multiple ? true : undefined },
  };
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions(
    [...popover.interactions, ...list.interactions, multiselectable],
  );
  const popoverValue = useMemo<PopoverContextValue>(
    () => ({ ...popover, getReferenceProps, getFloatingProps }),
    [popover, getReferenceProps, getFloatingProps],
  );
  const { activeIndex, elementsRef, labelsRef, markSelected } = list;
  const { close } = popover;
  const dropdownValue = useMemo<DropdownContextValue>(
    () => ({
      role: DropdownRoles.LISTBOX,
      selection,
      activeIndex,
      elementsRef,
      labelsRef,
      getItemProps,
      markSelected,
      close,
    }),
    [
      selection,
      activeIndex,
      elementsRef,
      labelsRef,
      getItemProps,
      markSelected,
      close,
    ],
  );

  return (
    <PopoverContext.Provider value={popoverValue}>
      <DropdownContext.Provider value={dropdownValue}>
        {props.children}
      </DropdownContext.Provider>
    </PopoverContext.Provider>
  );
}

export const Dropdown = Object.assign(DropdownRoot, {
  Trigger: PopoverTrigger,
  Content: DropdownContent,
  Item: DropdownItem,
  Group: DropdownGroup,
  Label: DropdownLabel,
  Separator: DropdownSeparator,
});
