import { useEffect, useId, useState, type ReactNode } from "react";

import { Callout } from "@web/components/Callout/Callout";
import styles from "./RiskChipDisclosure.module.scss";

export interface RiskChipDisclosureProps {
  /** The chip itself (a RiskBadge) — rendered inside the disclosure button.
   * Its text IS the button's accessible name; never override it. */
  children: ReactNode;
  /** Expansion content shown in the anchored callout. */
  detail: ReactNode;
}

/**
 * Keyboard/touch-accessible expansion for a risk chip: hover previews stay,
 * but the canonical affordance is a real button, because a `title` tooltip is
 * unreachable for sighted keyboard and touch users.
 */
export function RiskChipDisclosure({
  children,
  detail,
}: RiskChipDisclosureProps) {
  const [anchor, setAnchor] = useState<Element | null>(null);
  const detailId = useId();
  useEffect(() => {
    // Escape must dismiss a hover-opened callout too — focus may be
    // anywhere, so listen at the document while open.
    if (anchor === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Consume the key: it dismissed this callout — it must not ALSO
        // fire global shortcuts (e.g. exiting focus mode).
        event.stopPropagation();
        setAnchor(null);
      }
    };
    // Capture phase so the stopPropagation beats bubble-phase global
    // shortcut listeners regardless of registration order.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [anchor]);
  // Close on scroll: the portal'd panel repositions a frame late (stutter).
  useEffect(() => {
    if (anchor === null) return;
    const close = () => setAnchor(null);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [anchor]);
  return (
    // Hover EXIT is owned by Callout's safePolygon (its onClose): closing on
    // this span's mouseleave would kill the portal'd callout before the
    // pointer can travel into it.
    <span
      className={styles["root"]}
      onPointerEnter={(event) => {
        // Touch browsers synthesize mouseenter before click — a hover-open
        // there would be immediately toggled shut by the click. Hover
        // preview is a MOUSE affordance; touch/pen go through click.
        if (event.pointerType === "mouse") setAnchor(event.currentTarget);
      }}
    >
      {/* eslint-disable-next-line no-restricted-syntax -- reset wrapper making the inner chip interactive: component chrome would double it */}
      <button
        aria-controls={anchor ? detailId : undefined}
        aria-describedby={anchor ? detailId : undefined}
        aria-expanded={anchor !== null}
        className={styles["chipButton"]}
        type="button"
        onClick={(event) =>
          setAnchor(anchor === null ? event.currentTarget : null)
        }
      >
        {children}
      </button>
      {anchor ? (
        // Downwards: upwards lands under the sticky toolbar's controls.
        <Callout
          anchor={anchor}
          fit
          placement="bottom"
          onClose={() => setAnchor(null)}
        >
          <span className={styles["detail"]} id={detailId}>
            {detail}
          </span>
        </Callout>
      ) : null}
    </span>
  );
}
