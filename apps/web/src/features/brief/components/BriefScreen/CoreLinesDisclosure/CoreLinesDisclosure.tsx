import { useEffect, useId, useState, type ReactNode } from "react";

import { Callout } from "@web/components/Callout/Callout";
import styles from "./CoreLinesDisclosure.module.scss";

export interface CoreLinesDisclosureProps {
  /** Core (carrier-chunk) adjusted-line sums at the trigger's scope. */
  coreAdded: number;
  coreDeleted: number;
  /** The matching all-chunks adjusted-line sums. */
  allAdded: number;
  allDeleted: number;
  /** Visible trigger content — its text IS the button's accessible name. */
  children: ReactNode;
  /** Styles the wrapper span — the consumer's layout slot (flex item). */
  className?: string | undefined;
  /** Styles the trigger button; the consumer owns the content's look. */
  triggerClassName?: string | undefined;
}

/**
 * The core-lines mini panel: both line scopes plus the approximation caveat,
 * anchored to a real-button trigger in the RiskChipDisclosure grammar —
 * hover previews (mouse only), click is canonical for touch, keyboard focus
 * opens, Escape-at-capture dismisses without reaching page shortcuts.
 */
export function CoreLinesDisclosure({
  coreAdded,
  coreDeleted,
  allAdded,
  allDeleted,
  children,
  className,
  triggerClassName,
}: CoreLinesDisclosureProps) {
  const [anchor, setAnchor] = useState<Element | null>(null);
  const detailId = useId();
  useEffect(() => {
    // Escape must dismiss a hover-opened panel too — focus may be anywhere,
    // so listen at the document while open, capture phase, and consume the
    // key so it never reaches page-level shortcut handling.
    if (anchor === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setAnchor(null);
      }
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [anchor]);
  return (
    // Hover EXIT is owned by Callout's safePolygon (its onClose): closing on
    // this span's mouseleave would kill the portal'd callout before the
    // pointer can travel into it.
    <span
      className={className}
      onPointerEnter={(event) => {
        // Touch browsers synthesize mouseenter before click — a hover-open
        // there would be immediately toggled shut by the click. Hover
        // preview is a MOUSE affordance; touch/pen go through click.
        if (event.pointerType === "mouse") setAnchor(event.currentTarget);
      }}
    >
      <button
        aria-controls={anchor ? detailId : undefined}
        aria-describedby={anchor ? detailId : undefined}
        aria-expanded={anchor !== null}
        className={
          triggerClassName
            ? `${styles["trigger"]} ${triggerClassName}`
            : styles["trigger"]
        }
        data-state={anchor !== null ? "open" : "closed"}
        data-testid="core-lines-disclosure"
        type="button"
        onClick={(event) =>
          setAnchor(anchor === null ? event.currentTarget : null)
        }
        // Keyboard-only open: a mouse click focuses the button in some
        // browsers, and a plain focus-open there would fight the click
        // toggle (open on focus, immediately closed by the click).
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) {
            setAnchor(event.currentTarget);
          }
        }}
        onBlur={() => setAnchor(null)}
      >
        {children}
      </button>
      {anchor ? (
        <Callout anchor={anchor} fit onClose={() => setAnchor(null)}>
          <span className={styles["panel"]} id={detailId}>
            <dl className={styles["rows"]}>
              <dt>core lines</dt>
              <dd>
                <span className="green">+{coreAdded}</span>{" "}
                <span className="red">−{coreDeleted}</span>
              </dd>
              <dt>all adjusted lines</dt>
              <dd>
                <span className="green">+{allAdded}</span>{" "}
                <span className="red">−{allDeleted}</span>
              </dd>
            </dl>
            <span className={styles["caveat"]}>
              Adjusted approximation — not the raw git count. Exact lines are
              on GitHub.
            </span>
          </span>
        </Callout>
      ) : null}
    </span>
  );
}
