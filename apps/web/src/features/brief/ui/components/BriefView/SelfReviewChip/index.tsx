import { useTranslation } from "react-i18next";
import { useEffect, useId, useState } from "react";

import styles from "./SelfReviewChip.module.scss";

/**
 * The own-draft state label, non-dismissible and own-draft only. WCAG 1.4.13:
 * DISMISSABLE through a capture-phase Escape that hides only the tooltip, so a
 * hovering pointer user need not move and the key never reaches page handling;
 * HOVERABLE via visible-state pointer events; PERSISTENT while hovered or focused.
 */
export function SelfReviewChip() {
  const { t } = useTranslation();
  const tooltipId = useId();
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const [tooltipDismissed, setTooltipDismissed] = useState(false);
  const tooltipVisible = (hovered || focused) && !tooltipDismissed;
  useEffect(() => {
    if (!tooltipVisible) {
      return;
    }
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      event.stopPropagation();
      setTooltipDismissed(true);
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [tooltipVisible]);
  // Re-arm only when BOTH channels are idle: with hover and focus
  // overlapping, a per-channel re-arm (on mouseleave / on blur) would bring a
  // dismissed tooltip back while the OTHER channel still holds it visible,
  // Escape must stick for as long as either channel is active.
  useEffect(() => {
    if (!hovered && !focused) {
      setTooltipDismissed(false);
    }
  }, [focused, hovered]);
  return (
    <span className={styles["selfReviewChip"]} data-self-review-chip="">
      <span>{t("brief.header.selfReviewChip")}</span>
      <span
        className={styles["chipInfo"]}
        data-tooltip-dismissed={tooltipDismissed ? "" : undefined}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {/* oxlint-disable-next-line house/no-raw-button -- tooltip anchor (cursor: help, no onClick): not an action */}
        <button
          aria-describedby={tooltipId}
          aria-label={t("brief.header.ariaLabelAboutSelfReview")}
          className={styles["chipInfoButton"]}
          type="button"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
        >
          i
        </button>
        <span className={styles["chipTooltip"]} id={tooltipId} role="tooltip">
          {t("brief.header.selfReviewTooltip")}
        </span>
      </span>
    </span>
  );
}
