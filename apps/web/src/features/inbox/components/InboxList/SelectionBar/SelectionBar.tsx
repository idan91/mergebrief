import { useTranslation } from "react-i18next";
import { InboxArchivedFilters, type InboxArchivedFilter } from "types/inbox";

import { Button, ButtonVariants } from "@web/components/Button/Button";
import styles from "./SelectionBar.module.scss";

export interface SelectionBarProps {
  /** Ticked rows; nothing renders at zero. */
  count: number;
  /** Ticked rows the viewer may delete. */
  deletableCount: number;
  /** The view: Archive in the Inbox, Unarchive in the archived view. */
  archived: InboxArchivedFilter;
  /** A bulk action is running: every button holds. */
  busy: boolean;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}

/**
 * The bar that rises under the controls once rows are ticked: the count,
 * Archive for every ticked row, Delete for the ones the viewer may delete,
 * and Clear. The list announces the count from a region that outlives the
 * bar, so the first tick and the clear are read out too.
 */
export function SelectionBar({
  count,
  deletableCount,
  archived,
  busy,
  onArchive,
  onDelete,
  onClear,
}: SelectionBarProps) {
  const { t } = useTranslation();
  if (count === 0) {
    return null;
  }

  const undeletable = count - deletableCount;
  const archiveLabel =
    archived === InboxArchivedFilters.ONLY
      ? t("home.inbox.select.unarchive", { count })
      : t("home.inbox.select.archive", { count });

  return (
    <div className={styles["bar"]} data-testid="selection-bar">
      <p className={styles["count"]}>
        {t("home.inbox.select.count", { count })}
      </p>
      {undeletable > 0 ? (
        <span className={styles["note"]}>
          {t("home.inbox.select.undeletable", { count: undeletable })}
        </span>
      ) : null}
      <div className={styles["actions"]}>
        <Button
          disabled={busy}
          size="sm"
          variant={ButtonVariants.SECONDARY}
          onClick={onArchive}
        >
          {archiveLabel}
        </Button>
        <Button
          disabled={busy || deletableCount === 0}
          size="sm"
          variant={ButtonVariants.DANGER}
          onClick={onDelete}
        >
          {t("home.inbox.select.delete", { count: deletableCount })}
        </Button>
        <Button
          disabled={busy}
          size="sm"
          variant={ButtonVariants.QUIET}
          onClick={onClear}
        >
          {t("home.inbox.select.clear")}
        </Button>
      </div>
    </div>
  );
}
