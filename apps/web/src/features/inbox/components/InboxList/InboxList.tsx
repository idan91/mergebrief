import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useAnnouncer } from "@web/hooks/useAnnouncer";
import { useTranslation } from "react-i18next";
import {
  InboxArchivedFilters,
  type InboxArchivedFilter,
  type InboxSort,
  InboxLayouts,
  type InboxLayout,
} from "types/inbox";

import { Checkbox } from "@web/components/Checkbox/Checkbox";
import { ScreenReaderOnly } from "@web/components/ScreenReaderOnly/ScreenReaderOnly";
import { FIRST_LOAD_SETTLE_MS } from "../../consts";
import type { InboxItem } from "../../types";
import { readRowKey, splitAtFold } from "../../utils";
import { DeleteModal } from "./DeleteModal/DeleteModal";
import styles from "./InboxList.module.scss";
import { InboxRow } from "./InboxRow/InboxRow";
import { SelectionBar } from "./SelectionBar/SelectionBar";
import { useInboxArchiveFacade } from "./useInboxArchiveFacade";
import { useInboxCursor } from "./useInboxCursor";
import { useInboxDeleteFacade } from "./useInboxDeleteFacade";
import { useInboxSelection } from "./useInboxSelection";

export interface InboxListProps {
  items: readonly InboxItem[];
  sort: InboxSort;
  /** Folded splits the rows at the fold; mixed keeps them in the sort's order. */
  layout: InboxLayout;
  /** The Inbox, or the viewer's archived rows. */
  archived?: InboxArchivedFilter;
  /** Names the page the rows answer; a change clears the selection. */
  pageKey?: string;
  /** The filters and the sort, on the heading's line. */
  controls?: ReactNode;
  /** What stands where the rows would, when there are none to show. */
  children?: ReactNode;
}

/**
 * The list under its heading. Folded, it splits at the fold: rows that
 * need the reviewer, a quiet line, then the rest, each side in the server
 * order; mixed, it is one list in that order.
 * On first load the rows fade up with a short stagger; the attribute that
 * arms it leaves once the last row has landed, so a later re-read replays
 * nothing. The keyboard cursor counts rows straight through both sides,
 * and one live region below the list announces what a row action did.
 */
export function InboxList({
  items,
  sort,
  layout,
  archived = InboxArchivedFilters.HIDE,
  pageKey = "",
  controls,
  children,
}: InboxListProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const firstLoad = useFirstLoad();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cursorRowRef = useRef<HTMLLIElement>(null);
  const announcer = useAnnouncer();
  const { above, below } =
    layout === InboxLayouts.FOLDED
      ? splitAtFold(items)
      : { above: items, below: [] };
  const ordered = [...above, ...below];
  const selection = useInboxSelection(ordered);
  const cursor = useInboxCursor(
    ordered.length,
    (index) => {
      const item = ordered[index];
      if (item === undefined) {
        return;
      }
      void navigate({
        to: "/repos/$repoId/pulls/$prNumber",
        params: { repoId: item.repoId, prNumber: String(item.prNumber) },
      });
    },
    (index) => {
      const item = ordered[index];
      if (item !== undefined) {
        selection.toggle(item);
      }
    },
  );
  const { clear: clearSelection } = selection;
  // The selection belongs to one page of one search; the URL is outside React.
  useEffect(() => {
    clearSelection();
  }, [pageKey, clearSelection]);
  const now = new Date();
  const showFold = above.length > 0 && below.length > 0;

  // The page scrolls smoothly for anchors; a key press must land at once.
  useEffect(() => {
    cursorRowRef.current?.scrollIntoView({
      block: "nearest",
      behavior: "instant",
    });
  }, [cursor]);

  // The row's menu returns focus to its trigger as it leaves; the heading
  // takes it on the next frame, and keeps it once the row is gone.
  const focusHeading = useCallback((): void => {
    window.requestAnimationFrame(() => headingRef.current?.focus());
  }, []);
  // The ticks come off the rows that went before the re-read lands, so the
  // bar never offers those rows again while the list still shows them.
  const { remove: removeSelected } = selection;
  const handleGone = useCallback(
    (gone: readonly InboxItem[]): void => {
      removeSelected(gone);
      focusHeading();
    },
    [focusHeading, removeSelected],
  );
  const handleRowGone = useCallback(
    (item: InboxItem): void => handleGone([item]),
    [handleGone],
  );
  const deletion = useInboxDeleteFacade({
    announce: announcer.announce,
    onDeleted: handleGone,
  });
  const archiving = useInboxArchiveFacade({
    announce: announcer.announce,
    onRemoved: handleGone,
  });
  const { requestDelete } = deletion;
  const handleDelete = useCallback(
    (item: InboxItem): void => requestDelete([item]),
    [requestDelete],
  );
  const deletable = selection.selectedItems.filter(
    (item) => item.viewerCanDelete,
  );
  const busy = deletion.busy || archiving.busy;
  const deleteOpen = deletion.pending.length > 0;
  const selectedCount = selection.selectedItems.length;
  const selectionText =
    selectedCount === 0
      ? t("home.inbox.select.none")
      : t("home.inbox.select.count", { count: selectedCount });

  function confirmDelete(): void {
    void deletion.confirm();
  }
  function archiveSelected(): void {
    void archiving.archiveMany(selection.selectedItems, archived);
  }
  function requestBulkDelete(): void {
    deletion.requestDelete(deletable);
  }
  // Clear unmounts the bar under the focused button; the heading takes it.
  function handleClear(): void {
    selection.clear();
    focusHeading();
  }

  return (
    <section aria-labelledby="inbox-heading" className={styles["inbox"]}>
      <div className={styles["head"]}>
        <h2
          className={styles["heading"]}
          id="inbox-heading"
          ref={headingRef}
          tabIndex={-1}
        >
          {t("home.inbox.heading")}
        </h2>
        {controls}
      </div>
      <SelectionBar
        archived={archived}
        busy={busy}
        count={selection.selectedItems.length}
        deletableCount={deletable.length}
        onArchive={archiveSelected}
        onClear={handleClear}
        onDelete={requestBulkDelete}
      />
      {children}
      <div
        className={styles["lists"]}
        data-first-load={firstLoad}
        hidden={ordered.length === 0}
      >
        <div className={styles["pageSelect"]}>
          <Checkbox
            checked={selection.allSelected}
            indeterminate={selection.someSelected}
            onChange={selection.selectPage}
          >
            <ScreenReaderOnly>{t("home.inbox.select.page")}</ScreenReaderOnly>
          </Checkbox>
        </div>
        {above.length === 0 ? null : (
          <ol className={styles["list"]}>
            {above.map((item, index) => (
              <InboxRow
                cursor={index === cursor}
                index={index}
                item={item}
                key={readRowKey(item)}
                now={now}
                rowRef={index === cursor ? cursorRowRef : undefined}
                selected={selection.isSelected(item)}
                sort={sort}
                archived={archived}
                onAnnounce={announcer.announce}
                onDelete={handleDelete}
                onRemoved={handleRowGone}
                onToggleSelect={selection.toggle}
              />
            ))}
          </ol>
        )}
        {showFold ? (
          <p className={styles["fold"]} id="inbox-fold">
            {t("home.inbox.fold")}
          </p>
        ) : null}
        {below.length === 0 ? null : (
          <ol
            aria-labelledby={showFold ? "inbox-fold" : undefined}
            className={styles["list"]}
          >
            {below.map((item, index) => (
              <InboxRow
                cursor={above.length + index === cursor}
                index={above.length + index}
                item={item}
                key={readRowKey(item)}
                now={now}
                rowRef={
                  above.length + index === cursor ? cursorRowRef : undefined
                }
                selected={selection.isSelected(item)}
                sort={sort}
                archived={archived}
                onAnnounce={announcer.announce}
                onDelete={handleDelete}
                onRemoved={handleRowGone}
                onToggleSelect={selection.toggle}
              />
            ))}
          </ol>
        )}
      </div>
      <DeleteModal
        busy={deletion.busy}
        cancel={deletion.cancel}
        confirm={confirmDelete}
        items={deletion.pending}
        open={deleteOpen}
      />
      <p
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        role="status"
      >
        {announcer.text}
      </p>
      <p
        aria-atomic="true"
        aria-live="polite"
        className="sr-only"
        data-testid="selection-status"
        role="status"
      >
        {selectionText}
      </p>
    </section>
  );
}

function useFirstLoad(): boolean {
  const [firstLoad, setFirstLoad] = useState(true);
  useEffect(() => {
    const timer = window.setTimeout(
      () => setFirstLoad(false),
      FIRST_LOAD_SETTLE_MS,
    );

    return () => window.clearTimeout(timer);
  }, []);
  return firstLoad;
}
