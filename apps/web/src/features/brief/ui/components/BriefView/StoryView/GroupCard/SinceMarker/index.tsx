import { useState } from "react";
import { useTranslation } from "react-i18next";

import { Callout } from "@web/components/Callout";
import { useCalloutHover } from "@web/components/Callout/useCalloutHover";
import { LinkButton } from "@web/components/LinkButton";
import styles from "./SinceMarker.module.scss";

export interface SinceMarkerProps {
  /** Distinct member files changed since the checkpoint (0 = unchanged). */
  changedFileCount: number;
  /** The checkpoint's short SHA, already truncated for display. */
  baselineShortSha: string;
  /**
   * Opens the last-review comparison (Compare = Your last review). Route-owned, absent
   * where no navigation is wired (the local demo path); the marker then
   * renders as plain text.
   */
  openComparison?: (() => void) | undefined;
}

/**
 * Surfaces the last-review delta in the group header with Compare off.
 * Router-free by design: BriefView renders without a RouterProvider in
 * tests, so navigation arrives as an injected callback, never a router hook.
 */
export function SinceMarker({
  changedFileCount,
  baselineShortSha,
  openComparison,
}: SinceMarkerProps) {
  const { t } = useTranslation();
  const [anchor, setAnchor] = useState<HTMLButtonElement | null>(null);
  const hover = useCalloutHover();
  if (changedFileCount === 0) {
    return (
      <span
        className={styles["marker"]}
        data-state="unchanged"
        data-testid="group-since-marker"
      >
        {t("brief.sinceMarker.unchanged")}
      </span>
    );
  }
  const label = t("brief.sinceMarker.changed", {
    count: changedFileCount,
    sha: baselineShortSha,
  });
  const description = t("brief.sinceMarker.titleOpenComparison");
  return (
    <span
      className={styles["marker"]}
      data-state="changed"
      data-testid="group-since-marker"
    >
      {openComparison === undefined ? (
        label
      ) : (
        <>
          <LinkButton
            aria-description={description}
            className={styles["deltaLink"]}
            ref={setAnchor}
            onBlur={hover.close}
            onClick={openComparison}
            onFocus={(event) => {
              if (event.currentTarget.matches(":focus-visible")) {
                hover.show();
              }
            }}
            onPointerEnter={hover.arm}
            onPointerLeave={hover.disarm}
          >
            {label}
          </LinkButton>
          {hover.open && anchor !== null ? (
            <Callout anchor={anchor} compact fit onClose={hover.close}>
              <Callout.Title>{description}</Callout.Title>
            </Callout>
          ) : null}
        </>
      )}
    </span>
  );
}
