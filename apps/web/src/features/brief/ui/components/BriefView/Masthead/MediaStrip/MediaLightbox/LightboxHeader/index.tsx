import { useTranslation } from "react-i18next";

import { AccessibleLink } from "@web/components/AccessibleLink";
import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { IconButton, IconButtonSizes } from "@web/components/IconButton";
import styles from "./LightboxHeader.module.scss";

export interface LightboxHeaderProps {
  headingId: string;
  /** The item's caption, shown as plain text. */
  label: string;
  position: number;
  count: number;
  /** "Open on GitHub"; absent for an outside host or a diagram. */
  githubLink?: string | undefined;
  onClose: () => void;
}

/** The open item's caption, its place in the strip, its original on GitHub, and Close. */
export function LightboxHeader({
  headingId,
  label,
  position,
  count,
  githubLink,
  onClose,
}: LightboxHeaderProps) {
  const { t } = useTranslation();
  const counter = t("brief.media.position", { position, count });

  return (
    <div className={styles["header"]}>
      <h2 className={styles["title"]} id={headingId} title={label}>
        {label}
      </h2>
      <span className={styles["counter"]}>{counter}</span>
      {githubLink === undefined ? null : (
        <AccessibleLink
          className={styles["link"]}
          href={githubLink}
          rel="noopener noreferrer"
          target="_blank"
        >
          <span className={styles["linkLabel"]}>
            {t("shell.media.openOnGithub")}
          </span>
          <Icon name={IconNames.ARROW_UP_RIGHT} size={IconSizes.SM} />
        </AccessibleLink>
      )}
      <IconButton
        label={t("brief.media.close")}
        size={IconButtonSizes.MD}
        onClick={onClose}
      >
        <Icon name={IconNames.X} />
      </IconButton>
    </div>
  );
}
