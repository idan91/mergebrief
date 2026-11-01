import { useTranslation } from "react-i18next";

import { AccessibleLink } from "@web/components/AccessibleLink";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { FAILED_ICON_NAMES, FAILED_WORDING_KEYS } from "./consts";
import type { MediaFailedRowKind } from "./types";
import { buildGitHubOriginalLink } from "./utils";
import styles from "./MediaFailedRow.module.scss";

export interface MediaFailedRowProps {
  kind: MediaFailedRowKind;
  /** The author's alt text; blank, the kind's wording stands in. */
  alt?: string | undefined;
  /** The address the author wrote, before any proxying; linked only on a GitHub host. */
  originalAddress?: string | undefined;
}

/**
 * Stands in for an image or video that did not load, whatever the cause.
 * A span throughout: it replaces an inline element inside a paragraph.
 */
export function MediaFailedRow({
  kind,
  alt,
  originalAddress,
}: MediaFailedRowProps) {
  const { t } = useTranslation();
  const authorText = alt?.trim() ?? "";
  const failedWording = t(FAILED_WORDING_KEYS[kind]);
  const hasAuthorText = authorText !== "";
  const wording = hasAuthorText ? authorText : failedWording;
  const iconLabel = hasAuthorText ? failedWording : undefined;
  const link =
    originalAddress === undefined
      ? undefined
      : buildGitHubOriginalLink(originalAddress);

  return (
    <span
      className={styles["row"]}
      data-state="failed"
      data-testid="media-failed-row"
    >
      <Icon
        className={styles["icon"]}
        label={iconLabel}
        name={FAILED_ICON_NAMES[kind]}
        size={IconSizes.MD}
      />
      <span className={styles["wording"]}>{wording}</span>
      {link === undefined ? null : (
        <AccessibleLink
          className={styles["link"]}
          href={link}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t("shell.media.openOnGithub")}
          <Icon name={IconNames.ARROW_UP_RIGHT} size={IconSizes.SM} />
        </AccessibleLink>
      )}
    </span>
  );
}
