import type { FloatingFocusManagerProps } from "@floating-ui/react";

import { PopoverFocusTargets, type PopoverFocusTarget } from "./types";

/** The entrance: opacity and scale from 0.97; on-screen movement never animates. */
export const POPOVER_ENTER_MS = 180;
export const POPOVER_OFFSET_PX = 6;
export const POPOVER_VIEWPORT_PADDING_PX = 8;

/** DESIGN.md's entrance curve; a JS transition cannot read the CSS token. */
export const POPOVER_ENTER_EASING = "cubic-bezier(0.23, 1, 0.32, 1)";

/** FloatingFocusManager's `initialFocus` per target: -1 leaves focus on the trigger. */
export const INITIAL_FOCUS_BY_TARGET: Record<PopoverFocusTarget, number> = {
  [PopoverFocusTargets.TRIGGER]: -1,
  [PopoverFocusTargets.CONTENT]: 0,
  [PopoverFocusTargets.LIST]: -1,
};

type FocusOrder = NonNullable<FloatingFocusManagerProps["order"]>;

/** The trigger stays in the focus loop of a disclosure; a list's loop is its rows alone. */
export const FOCUS_ORDER_BY_TARGET: Record<PopoverFocusTarget, FocusOrder> = {
  [PopoverFocusTargets.TRIGGER]: ["reference", "content"],
  [PopoverFocusTargets.CONTENT]: ["content"],
  [PopoverFocusTargets.LIST]: ["content"],
};
