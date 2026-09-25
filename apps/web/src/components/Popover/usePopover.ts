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
  type Placement,
  type ReferenceType,
} from "@floating-ui/react";
import {
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type RefObject,
} from "react";

import { prefersReducedMotion } from "../../utils/motion";
import {
  POPOVER_ENTER_EASING,
  POPOVER_ENTER_MS,
  POPOVER_OFFSET_PX,
  POPOVER_VIEWPORT_PADDING_PX,
} from "./consts";
import { PopoverFocusTargets, type PopoverFocusTarget } from "./types";
import { deriveTransformOrigin } from "./utils";

export interface PopoverOptions {
  placement?: Placement;
  /** Gap between the trigger's edge and the panel. */
  offsetPx?: number;
  /**
   * Off, the panel renders in the tree beside its trigger and tracks no
   * ancestor scroll: a panel under a sticky bar rides the bar natively, where
   * a body portal would stutter a frame behind it.
   */
  portal?: boolean;
  focusOnOpen?: PopoverFocusTarget;
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
      flip(),
      shift({ padding: POPOVER_VIEWPORT_PADDING_PX }),
    ],
  });
  const click = useClick(context);
  const dismiss = useDismiss(context, { capture: { escapeKey: true } });
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
