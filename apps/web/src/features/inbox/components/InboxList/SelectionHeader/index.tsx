import { useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { InboxArchivedFilters, type InboxArchivedFilter } from "types/inbox";

import { Button, ButtonVariants } from "@web/components/Button";
import { Checkbox } from "@web/components/Checkbox";
import { LinkButton } from "@web/components/LinkButton";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly";
import styles from "./SelectionHeader.module.scss";

export interface SelectionHeaderProps {
  /** Rows on this page. */
  pageCount: number;
  /** Rows matching the filters across every page. */
  total: number;
  /** The most rows a matching-wide action takes. */
  cap: number;
  selectedCount: number;
  /** Ticked rows the viewer may delete. */
  deletableCount: number;
  allSelected: boolean;
  someSelected: boolean;
  /** The reviewer chose every matching row, beyond this page. */
  allMatching: boolean;
  /** The view: Archive in the Inbox, Unarchive in the archived view. */
  archived: InboxArchivedFilter;
  /** A bulk action is running: every action holds. */
  busy: boolean;
  onSelectPage: () => void;
  onSelectAllMatching: () => void;
  onClearAllMatching: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onClear: () => void;
}

/**
 * The header row on the list, on the rows' own grid: the page checkbox
 * over the row checkboxes, the count or a hint beside it, the way to every
 * matching row once the page is ticked, and the bulk actions at the end.
 */
export function SelectionHeader({
  pageCount,
  total,
  cap,
  selectedCount,
  deletableCount,
  allSelected,
  someSelected,
  allMatching,
  archived,
  busy,
  onSelectPage,
  onSelectAllMatching,
  onClearAllMatching,
  onArchive,
  onDelete,
  onClear,
}: SelectionHeaderProps) {
  const { t } = useTranslation();
  const matchingRef = useRef<HTMLButtonElement>(null);
  const onlyPageRef = useRef<HTMLButtonElement>(null);
  const pageRef = useRef<HTMLInputElement>(null);
  const focusSwap = useRef(false);
  // Either link unmounts under the pointer or the keyboard as it swaps for
  // the other; the replacement takes the focus, the page checkbox failing that.
  useEffect(() => {
    if (!focusSwap.current) {
      return;
    }
    focusSwap.current = false;
    const replacement = allMatching ? onlyPageRef.current : matchingRef.current;
    (replacement ?? pageRef.current)?.focus();
  }, [allMatching]);
  function handleSelectAllMatching(): void {
    focusSwap.current = true;
    onSelectAllMatching();
  }
  function handleClearAllMatching(): void {
    focusSwap.current = true;
    onClearAllMatching();
  }
  const capped = cap < total;
  const matched = Math.min(total, cap);
  const beyondPage = total > pageCount;
  const undeletable = selectedCount - deletableCount;
  const selecting = selectedCount > 0;
  const actionCount = allMatching ? matched : selectedCount;

  let middle: ReactNode;
  if (allMatching) {
    middle = (
      <>
        <strong>
          {capped
            ? t("home.inbox.select.firstMatching", { cap, count: total })
            : t("home.inbox.select.allMatching", { count: total })}
        </strong>
        <span aria-hidden="true"> · </span>
        <LinkButton
          disabled={busy}
          ref={onlyPageRef}
          onClick={handleClearAllMatching}
        >
          {t("home.inbox.select.onlyPage")}
        </LinkButton>
      </>
    );
  } else if (!selecting) {
    middle = (
      <span className={styles["hint"]}>
        {t("home.inbox.select.hint", { page: pageCount, count: total })}
      </span>
    );
  } else {
    middle = (
      <>
        <strong>
          {t("home.inbox.select.count", { count: selectedCount })}
        </strong>
        {undeletable > 0 ? (
          <>
            <span aria-hidden="true"> · </span>
            {t("home.inbox.select.undeletable", { count: undeletable })}
          </>
        ) : null}
        {allSelected && beyondPage ? (
          <>
            <span aria-hidden="true"> · </span>
            <LinkButton
              disabled={busy}
              ref={matchingRef}
              onClick={handleSelectAllMatching}
            >
              {capped
                ? t("home.inbox.select.matchingCapped", { cap, count: total })
                : t("home.inbox.select.matching", { count: total })}
            </LinkButton>
          </>
        ) : null}
      </>
    );
  }

  const archiveLabel =
    archived === InboxArchivedFilters.ONLY
      ? t("home.inbox.select.unarchive", { count: actionCount })
      : t("home.inbox.select.archive", { count: actionCount });
  const deleteLabel = allMatching
    ? t("home.inbox.select.deleteMatching")
    : t("home.inbox.select.delete", { count: deletableCount });
  const deleteHeld = busy || (!allMatching && deletableCount === 0);

  return (
    <div
      className={styles["header"]}
      data-selected={selecting}
      data-testid="selection-header"
    >
      <span className={styles["start"]}>
        <Checkbox
          checked={allSelected || allMatching}
          disabled={busy}
          indeterminate={someSelected}
          inputRef={pageRef}
          onChange={onSelectPage}
        >
          <ScreenReaderOnly>{t("home.inbox.select.page")}</ScreenReaderOnly>
        </Checkbox>
      </span>
      <p className={styles["middle"]}>{middle}</p>
      {selecting ? (
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
            disabled={deleteHeld}
            size="sm"
            variant={ButtonVariants.DANGER_OUTLINE}
            onClick={onDelete}
          >
            {deleteLabel}
          </Button>
          <Button
            disabled={busy}
            size="sm"
            variant={ButtonVariants.SECONDARY}
            onClick={onClear}
          >
            {t("home.inbox.select.clear")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
