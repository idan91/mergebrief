import {
  arrow,
  autoUpdate,
  flip,
  FloatingArrow,
  FloatingFocusManager,
  FloatingNode,
  FloatingPortal,
  FloatingTree,
  offset,
  safePolygon,
  shift,
  size,
  useFloating,
  useFloatingNodeId,
  useFloatingParentNodeId,
  useHover,
  useInteractions,
  useTransitionStyles,
  type OpenChangeReason,
  type Placement,
  type UseFloatingOptions,
} from "@floating-ui/react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import { prefersReducedMotion } from "../../utils/motion";
import { POPOVER_ENTER_EASING, POPOVER_ENTER_MS } from "../Popover/consts";
import { deriveTransformOrigin } from "../Popover/utils";
import styles from "./Callout.module.scss";
import { CalloutSurfaces, type CalloutSurface } from "./types";
import { useContentTabStop } from "./useContentTabStop";
import { areCalloutsWarm, holdCalloutsWarm } from "./utils";

export interface CalloutProps {
  /** Element the callout anchors to; the parent mounts on hover/focus. */
  anchor: Element;
  /** floating-ui placement; flip/shift adjust it to the viewport. */
  placement?: Placement;
  /** Size to content instead of the fixed 320px column. */
  fit?: boolean;
  /** Label density: the padding of a one-line name, not a card. */
  compact?: boolean;
  /** The content owns its padding and width: a list whose rows run to the edge. */
  flush?: boolean;
  /** Raised card by default; `ground` sits lower with a stronger edge. */
  surface?: CalloutSurface;
  /**
   * The panel holds a control (not just a description). Drops `role="tooltip"`
   * and lets Tab reach the portaled content; the parent owns return-focus.
   * Content taller than the viewport cap becomes a tab stop to scroll by key.
   */
  interactive?: boolean;
  /**
   * Called when the hover system (anchor + callout, joined by safePolygon)
   * is left; the parent unmounts the callout in response. The pointer can
   * travel into the callout and rest there (select, copy) without closing.
   * `reason` is floating-ui's: a pointer leave, or focus moving out.
   */
  onClose: (reason?: OpenChangeReason) => void;
  children: ReactNode;
}

/** The gap the callout keeps from the viewport edge. */
const VIEWPORT_MARGIN_PX = 8;

/**
 * A callout opened inside another joins its floating tree, so the outer one's
 * safePolygon reads the pointer resting on the inner one as still inside.
 */
function CalloutTreeBoundary({ children }: { children: ReactNode }) {
  const parentId = useFloatingParentNodeId();
  if (parentId !== null) {
    return children;
  }
  return <FloatingTree>{children}</FloatingTree>;
}

/**
 * Element-anchored hover callout, positioned by floating-ui: flips, shifts
 * and caps its height to stay inside the viewport, tracks the anchor while
 * scrolling, and points at it with an arrow. Mounted = open; the parent owns the
 * open state and gets `onClose` when hover leaves.
 */
function CalloutRoot({
  anchor,
  placement = "top",
  fit = false,
  compact = false,
  flush = false,
  surface = CalloutSurfaces.RAISED,
  interactive = false,
  onClose,
  children,
}: CalloutProps) {
  return (
    <CalloutTreeBoundary>
      <CalloutNode
        anchor={anchor}
        compact={compact}
        fit={fit}
        flush={flush}
        interactive={interactive}
        placement={placement}
        surface={surface}
        onClose={onClose}
      >
        {children}
      </CalloutNode>
    </CalloutTreeBoundary>
  );
}

function CalloutNode({
  anchor,
  placement,
  fit,
  compact,
  flush,
  surface,
  interactive,
  onClose,
  children,
}: Required<CalloutProps>) {
  const arrowRef = useRef<SVGSVGElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLSpanElement | null>(null);
  useContentTabStop(interactive ? contentEl : null);
  const [instant] = useState(areCalloutsWarm);
  // Only labels warm the next label; an open panel leaves the rest in place.
  useEffect(
    () => (interactive ? undefined : holdCalloutsWarm()),
    [interactive],
  );
  // safePolygon's 40ms close timer survives the unmount; once unmounted, the
  // parent may already show a new callout for the same anchor.
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const nodeId = useFloatingNodeId();
  const floatingOptions: UseFloatingOptions = {
    open: true,
    onOpenChange: (open, _event, reason) => {
      if (!open && mounted.current) {
        onClose(reason);
      }
    },
    placement,
    elements: { reference: anchor },
    // Position via top/left so the enter transition can own `transform`
    // without fighting the positioning transform.
    transform: false,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(10),
      flip(),
      shift({ padding: VIEWPORT_MARGIN_PX }),
      size({
        padding: VIEWPORT_MARGIN_PX,
        apply({ availableHeight, elements }) {
          elements.floating.style.maxBlockSize = `${String(Math.max(0, availableHeight))}px`;
        },
      }),
      arrow({ element: arrowRef }),
    ],
  };
  if (nodeId !== undefined) {
    floatingOptions.nodeId = nodeId;
  }
  const {
    refs,
    floatingStyles,
    context,
    placement: resolvedPlacement,
  } = useFloating(floatingOptions);
  const hover = useHover(context, { handleClose: safePolygon() });
  const { getFloatingProps } = useInteractions([hover]);
  const reduceMotion = prefersReducedMotion();
  const { styles: transitionStyles } = useTransitionStyles(context, {
    duration: reduceMotion || instant ? 0 : POPOVER_ENTER_MS,
    common: { transitionTimingFunction: POPOVER_ENTER_EASING },
    initial: { opacity: 0, transform: "scale(0.97)" },
  });
  const floatingStyle = {
    ...floatingStyles,
    ...transitionStyles,
    transformOrigin: deriveTransformOrigin(resolvedPlacement),
  };
  const floating = (
    <span
      className={styles["callout"]}
      data-callout=""
      data-compact={compact ? "" : undefined}
      data-fit={fit ? "" : undefined}
      data-flush={flush ? "" : undefined}
      data-surface={surface}
      ref={refs.setFloating}
      role={interactive ? undefined : "tooltip"}
      style={floatingStyle}
      {...getFloatingProps()}
    >
      <FloatingArrow
        className={styles["arrow"]}
        context={context}
        ref={arrowRef}
        // Hairline to match the callout border (--color-outline-2; SVG presentation
        // attributes cannot resolve CSS custom properties).
        stroke="#2b2b32"
        strokeWidth={1}
      />
      <span className={styles["content"]} ref={setContentEl}>
        {children}
      </span>
    </span>
  );
  return (
    <FloatingNode id={nodeId}>
      <FloatingPortal>
        {interactive ? (
          <FloatingFocusManager
            context={context}
            initialFocus={-1}
            modal={false}
            order={["reference", "content"]}
            returnFocus={false}
          >
            {floating}
          </FloatingFocusManager>
        ) : (
          floating
        )}
      </FloatingPortal>
    </FloatingNode>
  );
}

function CalloutEyebrow({ children }: { children: ReactNode }) {
  return <span className={styles["eyebrow"]}>{children}</span>;
}

export interface CalloutTitleProps {
  children: ReactNode;
  /**
   * Max lines before the title clamps with an ellipsis, a display-side
   * guard for model-authored text; the data stays intact. Unset = no clamp.
   */
  clamp?: number | undefined;
}

function CalloutTitle({ children, clamp }: CalloutTitleProps) {
  return (
    <span
      className={styles["title"]}
      data-clamp={clamp !== undefined ? "" : undefined}
      style={clamp !== undefined ? { WebkitLineClamp: clamp } : undefined}
    >
      {children}
    </span>
  );
}

function CalloutBody({ children }: { children: ReactNode }) {
  return <span className={styles["body"]}>{children}</span>;
}

/** De-emphasized origin line under the payload ("In: <group>"). */
function CalloutContext({ children }: { children: ReactNode }) {
  return <span className={styles["context"]}>{children}</span>;
}

export const Callout = Object.assign(CalloutRoot, {
  Eyebrow: CalloutEyebrow,
  Title: CalloutTitle,
  Body: CalloutBody,
  Context: CalloutContext,
});
