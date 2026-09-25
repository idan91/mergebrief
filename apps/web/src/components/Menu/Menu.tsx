import { useInteractions } from "@floating-ui/react";
import { useMemo, type ReactNode } from "react";

import { DropdownContent } from "../Dropdown/Content/Content";
import {
  DropdownContext,
  type DropdownContextValue,
} from "../Dropdown/context";
import { DropdownGroup } from "../Dropdown/Group/Group";
import { DropdownLabel } from "../Dropdown/Label/Label";
import { DropdownSeparator } from "../Dropdown/Separator/Separator";
import { DropdownRoles } from "../Dropdown/types";
import { useDropdownList } from "../Dropdown/useDropdownList";
import { PopoverContext, type PopoverContextValue } from "../Popover/context";
import { PopoverTrigger } from "../Popover/Trigger/Trigger";
import { PopoverFocusTargets } from "../Popover/types";
import { usePopover, type PopoverOptions } from "../Popover/usePopover";
import { MenuItem } from "./Item/Item";

export interface MenuProps extends Omit<PopoverOptions, "focusOnOpen"> {
  children: ReactNode;
}

/**
 * The action list: a menu button whose rows fire `onSelect`. Same keys as
 * Dropdown; a row closes the menu unless it states a choice with `checked`.
 */
function MenuRoot({ placement, offsetPx, portal, children }: MenuProps) {
  const popover = usePopover({
    placement,
    offsetPx,
    portal,
    focusOnOpen: PopoverFocusTargets.LIST,
  });
  const list = useDropdownList(popover.context, { role: DropdownRoles.MENU });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions(
    [...popover.interactions, ...list.interactions],
  );
  const popoverValue = useMemo<PopoverContextValue>(
    () => ({ ...popover, getReferenceProps, getFloatingProps }),
    [popover, getReferenceProps, getFloatingProps],
  );
  const { activeIndex, elementsRef, labelsRef, markSelected } = list;
  const { close } = popover;
  const menuValue = useMemo<DropdownContextValue>(
    () => ({
      role: DropdownRoles.MENU,
      selection: undefined,
      activeIndex,
      elementsRef,
      labelsRef,
      getItemProps,
      markSelected,
      close,
    }),
    [activeIndex, elementsRef, labelsRef, getItemProps, markSelected, close],
  );

  return (
    <PopoverContext.Provider value={popoverValue}>
      <DropdownContext.Provider value={menuValue}>
        {children}
      </DropdownContext.Provider>
    </PopoverContext.Provider>
  );
}

export const Menu = Object.assign(MenuRoot, {
  Trigger: PopoverTrigger,
  Content: DropdownContent,
  Item: MenuItem,
  Group: DropdownGroup,
  Label: DropdownLabel,
  Separator: DropdownSeparator,
});
