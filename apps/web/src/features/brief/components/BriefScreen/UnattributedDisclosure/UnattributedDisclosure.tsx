import { useTranslation } from "react-i18next";
import { useEffect, useId, useRef, useState } from "react";

import { Callout } from "@web/components/Callout/Callout";
import type { UnattributedView } from "../../../utils/viewModel";
import styles from "./UnattributedDisclosure.module.scss";

export interface UnattributedDisclosureProps {
  /** The brief's unattributed remainder (non-empty at this render). */
  view: UnattributedView;
  /** Whole-change line total (chunks + remainder) — the caveat's "of Y". */
  totalChanged: number;
  /** Styles the trigger button; the header owns the stat cell look. */
  triggerClassName?: string | undefined;
}

/**
 * The header's "unattributed" stat + per-file mini panel, in the
 * CoreLinesDisclosure grammar — hover previews (mouse only), click is
 * canonical for touch, keyboard focus opens, Escape-at-capture dismisses,
 * scroll closes.
 */
export function UnattributedDisclosure({
  view,
  totalChanged,
  triggerClassName,
}: UnattributedDisclosureProps) {
  const { t } = useTranslation();

  const [anchor, setAnchor] = useState<Element | null>(null);

  // Hover-open must anchor the BUTTON: in the header stats grid the wrapper
  // span is display:contents (no box), so its rect would place the callout
  // at the viewport origin.
  const triggerRef = useRef<HTMLButtonElement | null>(null);
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

  // Close on scroll: the portal'd panel repositions a frame late (stutter).
  useEffect(() => {
    if (anchor === null) return;
    const close = () => setAnchor(null);
    window.addEventListener("scroll", close, { capture: true, passive: true });
    return () => window.removeEventListener("scroll", close, { capture: true });
  }, [anchor]);

  const attributed = totalChanged - view.added - view.deleted;

  return (
    // Hover EXIT is owned by Callout's safePolygon (its onClose): closing on
    // this span's mouseleave would kill the portal'd callout before the
    // pointer can travel into it.
    <span
      onPointerEnter={(event) => {
        // Touch browsers synthesize mouseenter before click — hover preview
        // is a MOUSE affordance; touch/pen go through click.
        if (event.pointerType === "mouse") setAnchor(triggerRef.current);
      }}
    >
      {/* eslint-disable-next-line no-restricted-syntax -- headless zero-specificity trigger wrapper: the stat cell carries the visuals */}
      <button
        ref={triggerRef}
        aria-controls={anchor ? detailId : undefined}
        aria-describedby={anchor ? detailId : undefined}
        aria-expanded={anchor !== null}
        className={
          triggerClassName
            ? `${styles["trigger"]} ${triggerClassName}`
            : styles["trigger"]
        }
        data-state={anchor !== null ? "open" : "closed"}
        data-testid="unattributed-disclosure"
        type="button"
        onClick={(event) =>
          setAnchor(anchor === null ? event.currentTarget : null)
        }
        // Keyboard-only open: a mouse click focuses the button in some
        // browsers, and a plain focus-open would fight the click toggle.
        onFocus={(event) => {
          if (event.currentTarget.matches(":focus-visible")) {
            setAnchor(event.currentTarget);
          }
        }}
        onBlur={() => setAnchor(null)}
      >
        <span className={styles["labelCell"]}>
          {t("brief.unattributed.label")}
          <span aria-hidden="true" className={styles["warnDot"]} />
        </span>

        <b>
          <span className="green">+{view.added}</span>{" "}
          <span className="faint">/</span>{" "}
          <span className="red">−{view.deleted}</span>
        </b>
      </button>
      {anchor ? (
        // Downwards: upwards lands under the sticky toolbar's controls.
        <Callout
          anchor={anchor}
          fit
          placement="bottom"
          onClose={() => setAnchor(null)}
        >
          <span className={styles["panel"]} id={detailId}>
            <span className={styles["title"]}>
              {t("brief.unattributed.calloutTitle")}
            </span>

            <dl className={styles["rows"]}>
              {view.files.map((file) => (
                <div className={styles["row"]} key={file.file}>
                  <dt>{file.file}</dt>
                  <dd>
                    <span className="green">+{file.added}</span>{" "}
                    <span className="red">−{file.deleted}</span>
                  </dd>
                </div>
              ))}
            </dl>

            <span className={styles["caveat"]}>
              {t("brief.unattributed.calloutCaveat", {
                attributed,
                total: totalChanged,
              })}
            </span>
          </span>
        </Callout>
      ) : null}
    </span>
  );
}
