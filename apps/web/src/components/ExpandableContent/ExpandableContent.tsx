import {
  type CSSProperties,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

import styles from "./ExpandableContent.module.scss";
import { exceedsCap, parseCapPx } from "./utils";

/** Used only where the stylesheet's `--prose-cap` cannot be resolved. */
const CAP_FALLBACK_PX = 200;
const ROOT_FONT_SIZE_FALLBACK_PX = 16;

// csstype's CSSProperties has no `--*` index; a typed extension (the
// DiffTable/Header pattern) keeps the custom property cast-free.
interface ExpandableContentStyle extends CSSProperties {
  "--prose-full"?: string;
}

export interface ExpandableContentProps {
  children: ReactNode;
  /** Control copy while collapsed; the arrow glyph is decorative and added here. */
  expandLabel?: string | undefined;
  collapseLabel?: string | undefined;
  className?: string | undefined;
  testId?: string | undefined;
}

/**
 * Text clipped to `--prose-cap` with a mask fade, an expand control, and
 * WCAG 2.4.11 focus-expands. The SSR default is `collapsed`, so fitting
 * content corrects to `fits` after hydration by dropping the control only —
 * the clip itself never moves, which is what keeps the correction shift-free.
 */
export function ExpandableContent({
  children,
  expandLabel = "Show full summary",
  collapseLabel = "Collapse summary",
  className,
  testId = "capped-prose",
}: ExpandableContentProps) {
  const [clipped, setClipped] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [contentHeightPx, setContentHeightPx] = useState<number | undefined>(
    undefined,
  );
  const rootRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const bodyId = useId();

  useEffect(() => {
    const root = rootRef.current;
    const content = contentRef.current;
    if (root === null || content === null) return;

    function measure(): void {
      if (root === null || content === null) return;
      const rootFontSize = Number.parseFloat(
        getComputedStyle(document.documentElement).fontSize,
      );
      const capPx =
        parseCapPx(
          getComputedStyle(root).getPropertyValue("--prose-cap"),
          Number.isFinite(rootFontSize)
            ? rootFontSize
            : ROOT_FONT_SIZE_FALLBACK_PX,
        ) ?? CAP_FALLBACK_PX;
      const height = content.scrollHeight;
      // Unrendered content (a host mounting this inside a `hidden` panel)
      // measures zero; reading that as `fits` would flash it uncapped on open.
      if (height === 0) return;
      setContentHeightPx(height);
      setClipped(exceedsCap(height, capPx));
    }

    measure();
    // Observes the UNCLIPPED content, not the capped box: the box's own size
    // is pinned while collapsed, so it would never report content growth.
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    return () => observer.disconnect();
  }, []);

  const state = !clipped ? "fits" : expanded ? "expanded" : "collapsed";

  // Rounded up: scrollHeight floors, and a fractional shortfall would clip
  // the last line's descenders once expanded.
  const style: ExpandableContentStyle =
    contentHeightPx === undefined
      ? {}
      : { "--prose-full": `${Math.ceil(contentHeightPx) + 1}px` };

  return (
    <div
      className={
        className === undefined
          ? styles["root"]
          : `${styles["root"]} ${className}`
      }
      data-state={state}
      data-testid={testId}
      ref={rootRef}
      style={style}
    >
      <div
        className={styles["body"]}
        id={bodyId}
        onFocus={() => {
          if (clipped) setExpanded(true);
        }}
      >
        <div className={styles["content"]} ref={contentRef}>
          {children}
        </div>
      </div>
      <button
        aria-controls={bodyId}
        aria-expanded={expanded}
        className={styles["toggle"]}
        data-testid={`${testId}-toggle`}
        type="button"
        onClick={() => {
          if (expanded) {
            // Collapsing takes back everything the reader scrolled through, so
            // a block that starts above the viewport would leave them stranded
            // far below where it now ends.
            const root = rootRef.current;
            if (root !== null && root.getBoundingClientRect().top < 0) {
              root.scrollIntoView({ block: "start" });
            }
          }
          setExpanded(!expanded);
        }}
      >
        {expanded ? collapseLabel : expandLabel}
        <span aria-hidden="true">{expanded ? "↑" : "↓"}</span>
      </button>
    </div>
  );
}
