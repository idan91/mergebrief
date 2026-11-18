import { useTranslation } from "react-i18next";

import { Icon } from "@web/components/Icon";
import { IconNames, IconSizes } from "@web/components/Icon/types";
import { LinkButton } from "@web/components/LinkButton";
import type { MediaLightboxHandle } from "@web/components/Markdown/context";
import type { SummaryMediaPointer } from "../types";
import styles from "./MediaPointer.module.scss";

export interface MediaPointerProps {
  pointer: SummaryMediaPointer;
  onOpen: MediaLightboxHandle["openMedia"];
}

/** "Before and after, in Media below": opens the lightbox at the set's first item. The label is text, never Markdown. */
export function MediaPointer({ pointer, onOpen }: MediaPointerProps) {
  const { t } = useTranslation();

  return (
    <p className={styles["pointer"]}>
      <Icon
        className={styles["icon"]}
        name={IconNames.FILM_STRIP}
        size={IconSizes.SM}
      />
      <LinkButton
        aria-haspopup="dialog"
        className={styles["link"]}
        onClick={(event) => {
          onOpen(pointer.firstItemKey, event.currentTarget);
        }}
      >
        {t("brief.media.pointer", { label: pointer.label })}
      </LinkButton>
    </p>
  );
}
