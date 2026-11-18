import { useTranslation } from "react-i18next";

import { AccessibleLink } from "@web/components/AccessibleLink";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { FAILED_ICON_NAMES } from "./consts";
import type { MediaFailedRowKind } from "./types";
import { describeRow } from "./utils";
import styles from "./MediaFailedRow.module.scss";

export interface MediaFailedRowProps {
  kind: MediaFailedRowKind;
  /** The author's alt text; blank, the kind's wording stands in. */
  alt?: string | undefined;
  /** The address the author wrote, before any proxying; linked on a GitHub host, or when `outsideHost` is set. */
  originalAddress?: string | undefined;
  /**
   * The host of an image left unloaded because neither this instance nor
   * GitHub serves it. The row then names the host and links the address.
   */
  outsideHost?: string | undefined;
  /** The row sits inside a link the author wrote, so its wording reads as that link. */
  linked?: boolean;
}

/**
 * Stands in for an image or video that is not shown: one that did not load,
 * whatever the cause, or an image on an outside host, which is never loaded.
 * A span throughout: it replaces an inline element inside a paragraph.
 */
export function MediaFailedRow({
  kind,
  alt,
  originalAddress,
  outsideHost,
  linked = false,
}: MediaFailedRowProps) {
  const { t } = useTranslation();
  const row = describeRow(t, { kind, alt, originalAddress, outsideHost });
  const linkedMark = linked ? "true" : undefined;

  return (
    <span
      className={styles["row"]}
      data-linked={linkedMark}
      data-state={row.state}
      data-testid="media-failed-row"
    >
      <Icon
        className={styles["icon"]}
        label={row.iconLabel}
        name={FAILED_ICON_NAMES[kind]}
        size={IconSizes.MD}
      />
      <span className={styles["wording"]}>{row.wording}</span>
      {row.link === undefined ? null : (
        <AccessibleLink
          className={styles["link"]}
          href={row.link.href}
          rel="noopener noreferrer"
          target="_blank"
        >
          {row.link.label}
          <Icon name={IconNames.ARROW_UP_RIGHT} size={IconSizes.SM} />
        </AccessibleLink>
      )}
    </span>
  );
}
