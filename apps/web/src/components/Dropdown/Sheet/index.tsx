import { FloatingPortal } from "@floating-ui/react";
import clsx from "clsx";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { BottomSheet } from "../../BottomSheet";
import { usePopoverContext } from "../../Popover/context";
import styles from "./Sheet.module.scss";

export interface DropdownSheetProps {
  /** Names both the sheet and its listbox. */
  label: string;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * The list on a BottomSheet. The floating element is the sheet's whole
 * layer, so a press on its scrim or handle is never an outside press: the
 * scrim closes on its own click, after a slow tap has landed.
 */
export function DropdownSheet({
  label,
  className,
  children,
}: DropdownSheetProps) {
  const { t } = useTranslation();
  const popover = usePopoverContext();
  if (!popover.open) {
    return null;
  }

  const sheet = (
    <div ref={popover.setFloating}>
      <BottomSheet
        close={popover.close}
        closeLabel={t("shell.sheet.close")}
        label={label}
      >
        <div
          {...popover.getFloatingProps()}
          aria-label={label}
          className={clsx(styles["list"], className)}
          id={popover.panelId}
          tabIndex={-1}
        >
          {children}
        </div>
      </BottomSheet>
    </div>
  );

  if (!popover.portal) {
    return sheet;
  }
  return <FloatingPortal>{sheet}</FloatingPortal>;
}
