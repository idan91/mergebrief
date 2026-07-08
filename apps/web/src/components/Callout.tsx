import {
  arrow,
  autoUpdate,
  flip,
  FloatingArrow,
  FloatingPortal,
  offset,
  safePolygon,
  shift,
  useFloating,
  useHover,
  useInteractions,
  useTransitionStyles,
  type Placement,
} from "@floating-ui/react";
import { useRef, type ReactNode } from "react";

import { prefersReducedMotion } from "../lib/motion";
import styles from "./Callout.module.scss";

export interface CalloutProps {
  /** Element the callout anchors to; the parent mounts on hover/focus. */
  anchor: Element;
  /** floating-ui placement; flip/shift adjust it to the viewport. */
  placement?: Placement;
  /** Size to content instead of the fixed 320px column. */
  fit?: boolean;
  /**
   * Called when the hover system (anchor + callout, joined by safePolygon)
   * is left — the parent unmounts the callout in response. The pointer can
   * travel into the callout and rest there (select, copy) without closing.
   */
  onClose: () => void;
  children: ReactNode;
}

/**
 * Element-anchored hover callout, positioned by floating-ui: flips and
 * shifts to stay inside the viewport, tracks the anchor while scrolling,
 * and points at it with an arrow. Mounted = open; the parent owns the
 * open state and gets `onClose` when hover leaves.
 */
/** How far the callout slides in from, toward its anchor. */
const ENTER_SLIDE: Record<string, string> = {
  top: "translateY(4px)",
  bottom: "translateY(-4px)",
  left: "translateX(4px)",
  right: "translateX(-4px)",
};

function CalloutRoot({
  anchor,
  placement = "top",
  fit = false,
  onClose,
  children,
}: CalloutProps) {
  const arrowRef = useRef<SVGSVGElement | null>(null);
  const { refs, floatingStyles, context } = useFloating({
    open: true,
    onOpenChange: (open) => {
      if (!open) onClose();
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
      shift({ padding: 8 }),
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
  return (
    <FloatingPortal>
      <span
        className={styles["callout"]}
        data-fit={fit ? "" : undefined}
        ref={refs.setFloating}
        role="tooltip"
        style={{ ...floatingStyles, ...transitionStyles }}
        {...getFloatingProps()}
      >
        <FloatingArrow
          className={styles["arrow"]}
          context={context}
          ref={arrowRef}
          // Hairline to match the callout border (--line2; SVG presentation
          // attributes cannot resolve CSS custom properties).
          stroke="#2b2b32"
          strokeWidth={1}
        />
        {children}
      </span>
    </FloatingPortal>
  );
}

function CalloutEyebrow({ children }: { children: ReactNode }) {
  return <span className={styles["eyebrow"]}>{children}</span>;
}

function CalloutTitle({ children }: { children: ReactNode }) {
  return <span className={styles["title"]}>{children}</span>;
}

function CalloutBody({ children }: { children: ReactNode }) {
  return <span className={styles["body"]}>{children}</span>;
}

export const Callout = Object.assign(CalloutRoot, {
  Eyebrow: CalloutEyebrow,
  Title: CalloutTitle,
  Body: CalloutBody,
});
