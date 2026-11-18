import type { ReactNode, RefObject } from "react";
import { useTranslation } from "react-i18next";

import { Icon } from "../../Icon";
import { IconNames, IconSizes } from "../../Icon/types";
import { IconButton, IconButtonSizes } from "../../IconButton";
import styles from "./Header.module.scss";

export interface ModalHeaderProps {
  /** The heading's id, which the dialog's `labelledBy` names. */
  id: string;
  title: ReactNode;
  /** One quiet line or paragraph under the title. */
  detail?: ReactNode;
  /** Sits on the title's line, outside the heading's name. */
  titleAside?: ReactNode;
  /** Absent hides the close control, as a dialog mid-write does. */
  close?: (() => void) | undefined;
  /** For a dialog that moves focus to its heading when its view changes. */
  headingRef?: RefObject<HTMLHeadingElement | null>;
}

/** A dialog's one header: its title, an optional detail and the close control. */
export function ModalHeader({
  id,
  title,
  detail,
  titleAside,
  close,
  headingRef,
}: ModalHeaderProps) {
  const { t } = useTranslation();
  const headingTabIndex = headingRef === undefined ? undefined : -1;

  return (
    <div className={styles["header"]}>
      <div className={styles["text"]}>
        <div className={styles["titleLine"]}>
          <h2
            className={styles["title"]}
            id={id}
            ref={headingRef}
            tabIndex={headingTabIndex}
          >
            {title}
          </h2>
          {titleAside}
        </div>
        {detail === undefined ? null : (
          <p className={styles["detail"]}>{detail}</p>
        )}
      </div>
      {close === undefined ? null : (
        <IconButton
          className={styles["close"]}
          label={t("shell.close")}
          size={IconButtonSizes.MD}
          onClick={close}
        >
          <Icon name={IconNames.X} size={IconSizes.MD} />
        </IconButton>
      )}
    </div>
  );
}
