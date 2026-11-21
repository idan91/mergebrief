import clsx from "clsx";
import { useTranslation } from "react-i18next";

import type { InboxGeneration, InboxItem } from "../../../../types";
import styles from "./RowReason.module.scss";
import { readHeldReason } from "./utils";

export interface RowReasonProps {
  generation: InboxGeneration | undefined;
  state: InboxItem["state"];
  className?: string | undefined;
}

/**
 * A held head's first reason on the row's second line, cut to the line so
 * the row keeps its height, with a count of the rest beside it.
 */
export function RowReason({ generation, state, className }: RowReasonProps) {
  const { t } = useTranslation();
  const reason = readHeldReason(t, generation, state);
  if (reason === undefined) {
    return null;
  }

  return (
    <span
      className={clsx(className, styles["reason"])}
      data-testid="inbox-row-reason"
    >
      <span className={styles["text"]}>{reason.text}</span>{" "}
      {reason.more > 0 ? (
        <span className={styles["more"]}>
          {t("home.inbox.held.more", { count: reason.more })}
        </span>
      ) : null}
    </span>
  );
}
