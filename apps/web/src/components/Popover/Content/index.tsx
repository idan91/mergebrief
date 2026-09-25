import { FloatingFocusManager, FloatingPortal } from "@floating-ui/react";
import clsx from "clsx";
import type { ReactNode } from "react";

import { FOCUS_ORDER_BY_TARGET, INITIAL_FOCUS_BY_TARGET } from "../consts";
import { usePopoverContext } from "../context";
import styles from "./Content.module.scss";

export interface PopoverContentProps {
  /** The panel's accessible name, where its role wants one. */
  label?: string | undefined;
  className?: string | undefined;
  children: ReactNode;
}

/**
 * The panel: positioned, focus-managed, portalled unless the root says
 * otherwise. A closing panel is inert for its exit, so neither a click nor a
 * Tab reaches a row that is leaving.
 */
export function PopoverContent({
  label,
  className,
  children,
}: PopoverContentProps) {
  const popover = usePopoverContext();
  if (!popover.transition.isMounted) {
    return null;
  }

  const initialFocus = INITIAL_FOCUS_BY_TARGET[popover.focusOnOpen];
  const order = FOCUS_ORDER_BY_TARGET[popover.focusOnOpen];
  const style = {
    ...popover.floatingStyles,
    ...popover.transition.styles,
    transformOrigin: popover.transformOrigin,
  };
  const panel = (
    <FloatingFocusManager
      context={popover.context}
      initialFocus={initialFocus}
      modal={false}
      order={order}
      returnFocus={false}
    >
      <div
        {...popover.getFloatingProps()}
        aria-label={label}
        className={clsx(styles["content"], className)}
        id={popover.panelId}
        inert={!popover.open || undefined}
        ref={popover.setFloating}
        style={style}
        tabIndex={-1}
      >
        {children}
      </div>
    </FloatingFocusManager>
  );

  if (!popover.portal) {
    return panel;
  }
  return <FloatingPortal>{panel}</FloatingPortal>;
}
