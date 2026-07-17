import { useEffect, useId, useState, type ReactNode } from "react";

import { Callout } from "../../../../components/Callout";
import styles from "./RiskChipDisclosure.module.scss";

export interface RiskChipDisclosureProps {
  /** The chip itself (a RiskBadge) — rendered inside the disclosure button.
   * Its text (including the chip's screen-reader-only expansion) IS the
   * button's accessible name — never overridden (codex r3). */
  children: ReactNode;
  /** Expansion content shown in the anchored callout. */
  detail: ReactNode;
}

/**
 * Keyboard/touch-accessible expansion for a risk chip (BRIEF-52, codex r1
 * a11y): hover previews stay, but the canonical affordance is a real button
 * — click/Enter toggles the anchored callout, Escape closes it,
 * `aria-expanded` reports state. Screen readers additionally get the inline
 * text the chips already carry; this disclosure serves sighted keyboard and
 * touch users, for whom a `title` tooltip is unreachable.
 */
export function RiskChipDisclosure({
  children,
  detail,
}: RiskChipDisclosureProps) {
  const [anchor, setAnchor] = useState<Element | null>(null);
  const detailId = useId();
  useEffect(() => {
    // Escape must dismiss a hover-opened callout too — focus may be
    // anywhere, so listen at the document while open (codex r5).
    if (anchor === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        // Consume the key: it dismissed this callout — it must not ALSO
        // fire global shortcuts (e.g. exiting focus mode) (codex r10).
        event.stopPropagation();
        setAnchor(null);
      }
    };
    // Capture phase so the stopPropagation beats bubble-phase global
    // shortcut listeners regardless of registration order.
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [anchor]);
  return (
    // Hover EXIT is owned by Callout's safePolygon (its onClose): closing on
    // this span's mouseleave would kill the portal'd callout before the
    // pointer can travel into it (codex r2).
    <span
      onPointerEnter={(event) => {
        // Touch browsers synthesize mouseenter before click — a hover-open
        // there would be immediately toggled shut by the click (codex r4).
        // Hover preview is a MOUSE affordance; touch/pen go through click.
        if (event.pointerType === "mouse") setAnchor(event.currentTarget);
      }}
    >
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
        <Callout anchor={anchor} fit onClose={() => setAnchor(null)}>
          <span className={styles["detail"]} id={detailId}>
            {detail}
          </span>
        </Callout>
      ) : null}
    </span>
  );
}
