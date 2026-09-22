import {
  autoUpdate,
  flip,
  FloatingFocusManager,
  FloatingList,
  FloatingPortal,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useInteractions,
  useListNavigation,
  useRole,
  useTransitionStyles,
  type Placement,
} from "@floating-ui/react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { prefersReducedMotion } from "../../utils/motion";
import { IconButton } from "../IconButton/IconButton";
import {
  MENU_ENTER_EASING,
  MENU_ENTER_MS,
  MENU_OFFSET_PX,
  MENU_VIEWPORT_PADDING_PX,
} from "./consts";
import { MenuContext } from "./context";
import { MenuTriggerKinds, type MenuTriggerKind } from "./types";
import { deriveTransformOrigin } from "./utils";
import styles from "./Menu.module.scss";

export interface MenuProps {
  /** The accessible name of the menu, and of an icon trigger. */
  label: string;
  /** What the trigger shows: an icon, an avatar, or a text control's content. */
  trigger: ReactNode;
  triggerKind?: MenuTriggerKind;
  /** A text trigger's accessible name when its content alone would mislead, such as a bare count. */
  triggerLabel?: string | undefined;
  triggerClassName?: string | undefined;
  /** An icon trigger wider than its square, such as an avatar with a caret. */
  triggerAutoWidth?: boolean;
  /** Rides on the trigger as `data-state` for the caller's stylesheet. */
  triggerState?: string | undefined;
  placement?: Placement;
  /** `MenuRow`s, and any static row such as an identity line. */
  children: ReactNode;
}

/**
 * A menu button: opens on click from its trigger, arrows move through the
 * rows, Escape, Tab and an outside press close it and focus returns to the
 * trigger. The entrance plays once per opening; content changing while it
 * is open replays nothing.
 */
export function Menu({
  label,
  trigger,
  triggerKind = MenuTriggerKinds.ICON,
  triggerLabel,
  triggerClassName,
  triggerAutoWidth = false,
  triggerState,
  placement = "bottom-end",
  children,
}: MenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const elementsRef = useRef<(HTMLElement | null)[]>([]);
  const {
    refs,
    floatingStyles,
    context,
    placement: resolvedPlacement,
  } = useFloating({
    open,
    onOpenChange: setOpen,
    placement,
    // Position via top/left so the enter transition owns `transform`.
    transform: false,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(MENU_OFFSET_PX),
      flip(),
      shift({ padding: MENU_VIEWPORT_PADDING_PX }),
    ],
  });
  const { getReferenceProps, getFloatingProps, getItemProps } = useInteractions(
    [
      useClick(context),
      useDismiss(context),
      useRole(context, { role: "menu" }),
      useListNavigation(context, {
        listRef: elementsRef,
        activeIndex,
        onNavigate: setActiveIndex,
        loop: true,
      }),
    ],
  );
  const { isMounted, styles: transitionStyles } = useTransitionStyles(context, {
    duration: prefersReducedMotion() ? 0 : MENU_ENTER_MS,
    initial: { opacity: 0, transform: "scale(0.97)" },
    common: { transitionTimingFunction: MENU_ENTER_EASING },
  });
  const menuContext = useMemo(
    () => ({
      activeIndex,
      getItemProps,
      // Focus goes home before the panel leaves, so a modal a row opens
      // captures the trigger, not a row that is about to unmount.
      close: () => {
        setOpen(false);
        const reference = refs.domReference.current;
        if (reference instanceof HTMLElement) {
          reference.focus();
        }
      },
    }),
    [activeIndex, getItemProps, refs.domReference],
  );

  return (
    <>
      {/* The interaction props are floating-ui's contract with the trigger. */}
      {triggerKind === MenuTriggerKinds.TEXT ? (
        // oxlint-disable-next-line house/no-raw-button -- the caller's own control shape (a filter) names itself by its content; no shared primitive has that shape
        <button
          {...getReferenceProps()}
          aria-label={triggerLabel}
          className={triggerClassName}
          data-state={triggerState}
          ref={refs.setReference}
          type="button"
        >
          {trigger}
        </button>
      ) : (
        <IconButton
          {...getReferenceProps()}
          autoWidth={triggerAutoWidth}
          className={triggerClassName}
          data-state={triggerState}
          label={label}
          ref={refs.setReference}
          size="md"
          variant="ghost"
        >
          {trigger}
        </IconButton>
      )}
      {isMounted ? (
        <FloatingPortal>
          <FloatingFocusManager context={context} modal={false}>
            <div
              {...getFloatingProps()}
              aria-label={label}
              className={styles["menu"]}
              ref={refs.setFloating}
              style={{
                ...floatingStyles,
                ...transitionStyles,
                transformOrigin: deriveTransformOrigin(resolvedPlacement),
              }}
            >
              <FloatingList elementsRef={elementsRef}>
                <MenuContext.Provider value={menuContext}>
                  {children}
                </MenuContext.Provider>
              </FloatingList>
            </div>
          </FloatingFocusManager>
        </FloatingPortal>
      ) : null}
    </>
  );
}
