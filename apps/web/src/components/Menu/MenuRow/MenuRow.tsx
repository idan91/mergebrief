import { useListItem } from "@floating-ui/react";
import type { ReactNode } from "react";

import { MenuItem, MenuItemRoles } from "../../MenuItem/MenuItem";
import { useMenuContext } from "../context";

export interface MenuRowProps {
  children: ReactNode;
  onSelect: () => void;
  /** A radio row states a choice; the menu closes on selection either way. */
  checked?: boolean;
  disabled?: boolean;
  /** A row whose work reports back into the menu, such as a sign out that can fail, leaves it open. */
  keepOpen?: boolean;
  className?: string | undefined;
  lang?: string | undefined;
}

/** One row of a `Menu`: a `MenuItem` the list navigation knows about. */
export function MenuRow({
  children,
  onSelect,
  checked,
  disabled = false,
  keepOpen = false,
  className,
  lang,
}: MenuRowProps) {
  const { ref, index } = useListItem();
  const menu = useMenuContext();
  const active = menu.activeIndex === index;
  const itemProps = menu.getItemProps({
    onClick() {
      onSelect();
      if (!keepOpen) menu.close();
    },
  });
  const shared = {
    ...itemProps,
    className,
    disabled,
    lang,
    ref,
    tabIndex: active ? 0 : -1,
  };

  if (checked === undefined) {
    return (
      <MenuItem {...shared} kind={MenuItemRoles.ITEM}>
        {children}
      </MenuItem>
    );
  }
  return (
    <MenuItem {...shared} checked={checked} kind={MenuItemRoles.RADIO}>
      {children}
    </MenuItem>
  );
}
