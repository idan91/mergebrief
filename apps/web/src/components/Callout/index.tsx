import {
  arrow,
  autoUpdate,
  flip,
  FloatingArrow,
  FloatingFocusManager,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  size,
  useFloating,
  useHover,
  useInteractions,
  useTransitionStyles,
  type Placement,
} from "@floating-ui/react";
import { useRef, useState, type ReactNode } from "react";

import { prefersReducedMotion } from "../../utils/motion";
import styles from "./Callout.module.scss";
import { CalloutSurfaces, type CalloutSurface } from "./types";
import { useContentTabStop } from "./useContentTabStop";

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
   */
  onClose: () => void;
  children: ReactNode;
}

/**
 * Element-anchored hover callout, positioned by floating-ui: flips, shifts
 * and caps its height to stay inside the viewport, tracks the anchor while
 * scrolling, and points at it with an arrow. Mounted = open; the parent owns the
 * open state and gets `onClose` when hover leaves.
 */
/** How far the callout slides in from, toward its anchor. */
const ENTER_SLIDE: Record<string, string> = {
  top: "translateY(4px)",
  bottom: "translateY(-4px)",
  left: "translateX(4px)",
  right: "translateX(-4px)",
};

/** The gap the callout keeps from the viewport edge. */
const VIEWPORT_MARGIN_PX = 8;

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
  const arrowRef = useRef<SVGSVGElement | null>(null);
  const [contentEl, setContentEl] = useState<HTMLSpanElement | null>(null);
  useContentTabStop(interactive ? contentEl : null);
  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) {
        onClose();
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
  });
  const hover = useHover(context, { handleClose: safePolygon() });
  const { getFloatingProps } = useInteractions([hover]);
  const reduceMotion = prefersReducedMotion();
  const { styles: transitionStyles } = useTransitionStyles(context, {
    duration: reduceMotion ? 0 : 140,
    common: { transitionTimingFunction: "cubic-bezier(0.22, 1, 0.36, 1)" },
    initial: ({ side }) => ({
      opacity: 0,
      transform: ENTER_SLIDE[side],
    }),
  });
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
      style={{ ...floatingStyles, ...transitionStyles }}
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
