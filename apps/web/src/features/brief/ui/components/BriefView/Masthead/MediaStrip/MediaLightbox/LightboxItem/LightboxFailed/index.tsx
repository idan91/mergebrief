import { useTranslation } from "react-i18next";

import { AccessibleLink } from "@web/components/AccessibleLink";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import {
  FAILED_ICON_NAMES,
  FAILED_WORDING_KEYS,
} from "@web/components/MediaFailedRow/consts";
import type { MediaFailedRowKind } from "@web/components/MediaFailedRow/types";
import styles from "./LightboxFailed.module.scss";

export interface LightboxFailedProps {
  kind: MediaFailedRowKind;
  /** "Open on GitHub"; absent for an outside host. */
  githubLink?: string | undefined;
}

/** The one failed state, centred in the stage; stepping on still works around it. */
export function LightboxFailed({ kind, githubLink }: LightboxFailedProps) {
  const { t } = useTranslation();

  return (
    <div className={styles["panel"]} data-testid="media-failed-panel">
      <Icon name={FAILED_ICON_NAMES[kind]} size={IconSizes.LG} />
      <p className={styles["wording"]}>{t(FAILED_WORDING_KEYS[kind])}</p>
      {githubLink === undefined ? null : (
        <AccessibleLink
          className={styles["link"]}
          href={githubLink}
          rel="noopener noreferrer"
          target="_blank"
        >
          {t("shell.media.openOnGithub")}
          <Icon name={IconNames.ARROW_UP_RIGHT} size={IconSizes.SM} />
        </AccessibleLink>
      )}
    </div>
  );
}
