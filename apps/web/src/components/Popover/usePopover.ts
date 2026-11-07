import {
  autoUpdate,
  flip,
  offset,
  shift,
  useClick,
  useDismiss,
  useFloating,
  useTransitionStyles,
  type ElementProps,
  type FloatingContext,
  type MiddlewareState,
  type Placement,
  type ReferenceType,
  type SideObject,
} from "@floating-ui/react";
import {
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

import {
  readNumericCssVar,
  STICKY_STACK_HEIGHT_VAR,
} from "../../utils/css-vars";
import { prefersReducedMotion } from "../../utils/motion";
import {
  POPOVER_ENTER_EASING,
  POPOVER_ENTER_MS,
  POPOVER_OFFSET_PX,
} from "./consts";
import { PopoverFocusTargets, type PopoverFocusTarget } from "./types";
import { deriveCollisionPadding, deriveTransformOrigin } from "./utils";

export interface PopoverOptions {
  placement?: Placement | undefined;
  /** Gap between the trigger's edge and the panel. */
  offsetPx?: number | undefined;
  /**
   * Off, the panel renders in the tree beside its trigger and tracks no
   * ancestor scroll: a panel under a sticky bar rides the bar natively, where
   * a body portal would stutter a frame behind it.
   */
  portal?: boolean | undefined;
  focusOnOpen?: PopoverFocusTarget | undefined;
  /** Fires once per opening, whatever opened it: click, Enter, or an arrow key. */
  onOpen?: (() => void) | undefined;
}

export interface PopoverState {
  readonly open: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly close: () => void;
  readonly context: FloatingContext;
  readonly panelId: string;
  readonly setReference: (node: Element | null) => void;
  readonly setFloating: (node: HTMLElement | null) => void;
  readonly floatingStyles: CSSProperties;
  /** A sheet's scrim, which closes on its own click. */
  readonly scrimRef: RefObject<HTMLDivElement | null>;
  readonly transition: {
    readonly isMounted: boolean;
    readonly styles: CSSProperties;
  };
  readonly transformOrigin: string;
  readonly portal: boolean;
  readonly focusOnOpen: PopoverFocusTarget;
  /** Click and dismiss; a root adds its own before `useInteractions`. */
  readonly interactions: ElementProps[];
}

function focusElement(element: Element | null): void {
  if (element instanceof HTMLElement) {
    element.focus();
  }
}

/**
 * Focus the trigger now, and again next frame if the list's own open focus,
 * queued a frame earlier, lands on a row of the closing panel.
 */
function reclaimFocus(
  trigger: Element | null,
  floating: RefObject<HTMLElement | null>,
): void {
  focusElement(trigger);
  window.requestAnimationFrame(() => {
    const panel = floating.current;
    if (panel !== null && panel.contains(document.activeElement)) {
      focusElement(trigger);
    }
  });
}

/** Read per computation: the stack's height moves as the header collapses. */
function readCollisionPadding(): SideObject {
  return deriveCollisionPadding(readNumericCssVar(STICKY_STACK_HEIGHT_VAR));
}

/**
 * Only a panel above its trigger slides along the block axis: one below a
 * trigger inside the pinned stack would otherwise leave for the stack's edge.
 */
function readShiftOptions({ placement }: MiddlewareState) {
  return {
    crossAxis: placement.startsWith("top"),
    padding: readCollisionPadding(),
  };
}

function trackWithAncestorScroll(
  reference: ReferenceType,
  floating: HTMLElement,
  update: () => void,
): () => void {
  return autoUpdate(reference, floating, update);
}

function trackWithoutAncestorScroll(
  reference: ReferenceType,
  floating: HTMLElement,
  update: () => void,
): () => void {
  return autoUpdate(reference, floating, update, { ancestorScroll: false });
}

/**
 * The open state, positioning and entrance of one panel beside its trigger.
 * Escape is claimed at capture so an open panel owns it before any page
 * shortcut; an outside press closes; the entrance plays once per opening.
 */
export function usePopover({
  placement = "bottom-start",
  offsetPx = POPOVER_OFFSET_PX,
  portal = true,
  focusOnOpen = PopoverFocusTargets.TRIGGER,
  onOpen,
}: PopoverOptions): PopoverState {
  const [open, setOpen] = useState(false);
  const fallbackId = useId();
  const {
    refs,
    floatingStyles,
    context,
    placement: resolvedPlacement,
  } = useFloating({
    open,
    // Focus return is this hook's, not the focus manager's: Escape and a
    // choice go home at once, an outside press or a Tab out leave focus where
    // it went, and nothing returns it a frame later on top of a modal.
    onOpenChange(next, _event, reason) {
      setOpen(next);
      if (next) {
        onOpen?.();
      }
      if (!next && reason === "escape-key") {
        reclaimFocus(refs.domReference.current, refs.floating);
      }
    },
    placement,
    // Position via top/left so the enter transition owns `transform`.
    transform: false,
    whileElementsMounted: portal
      ? trackWithAncestorScroll
      : trackWithoutAncestorScroll,
    middleware: [
      offset(offsetPx),
      flip(() => ({ padding: readCollisionPadding() })),
      shift(readShiftOptions),
    ],
  });
  const click = useClick(context);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  // Closing on the scrim's pointerdown removes it before a slow tap's click,
  // and that click lands on whatever sits behind it.
  const dismiss = useDismiss(context, {
    capture: { escapeKey: true },
    outsidePress: (event) => event.target !== scrimRef.current,
  });
  const reduceMotion = prefersReducedMotion();
  const transition = useTransitionStyles(context, {
    duration: reduceMotion ? 0 : POPOVER_ENTER_MS,
    initial: { opacity: 0, transform: "scale(0.97)" },
    close: { opacity: 0, transform: "scale(0.97)" },
    common: { transitionTimingFunction: POPOVER_ENTER_EASING },
  });
  // No entrance means no exit either: the panel leaves in the same commit.
  const isMounted = reduceMotion ? open : transition.isMounted;

  const panelId = context.floatingId ?? fallbackId;
  const transformOrigin = deriveTransformOrigin(resolvedPlacement);
  const transitionStyles = transition.styles;

  // The one memo behind the context value: PopoverRoot keys its provider value on this object.
  return useMemo<PopoverState>(
    () => ({
      open,
      setOpen,
      close() {
        setOpen(false);
        focusElement(refs.domReference.current);
      },
      context,
      panelId,
      setReference: refs.setReference,
      setFloating: refs.setFloating,
      floatingStyles,
      scrimRef,
      transition: { isMounted, styles: transitionStyles },
      transformOrigin,
      portal,
      focusOnOpen,
      interactions: [click, dismiss],
    }),
    [
      open,
      context,
      panelId,
      refs,
      floatingStyles,
      isMounted,
      transitionStyles,
      transformOrigin,
      portal,
      focusOnOpen,
      click,
      dismiss,
    ],
  );
}
