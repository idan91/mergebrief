import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import styles from "./ImageOpener.module.scss";

export interface ImageOpenerProps {
  /** The author's alt text; blank, the button names the image generically. */
  alt?: string | undefined;
  /** Opens the lightbox; focus returns to `opener` on close. */
  onOpen: (opener: HTMLElement) => void;
  children: ReactNode;
}

/** An inline image made a button that opens the lightbox at the image's place. */
export function ImageOpener({ alt, onOpen, children }: ImageOpenerProps) {
  const { t } = useTranslation();
  const authorText = alt?.trim() ?? "";
  const label =
    authorText === ""
      ? t("shell.media.enlargeImage")
      : t("shell.media.enlargeNamedImage", { alt: authorText });

  return (
    // oxlint-disable-next-line house/no-raw-button -- the author's image itself is the control; no shared primitive wraps an inline image
    <button
      aria-haspopup="dialog"
      aria-label={label}
      className={styles["opener"]}
      type="button"
      onClick={(event) => {
        onOpen(event.currentTarget);
      }}
    >
      {children}
      <span className={styles["badge"]}>
        <Icon name={IconNames.CORNERS_OUT} size={IconSizes.MD} />
      </span>
    </button>
  );
}
