import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Toast } from "@web/components/Toast";
import type { ToastAction } from "@web/components/Toast/types";
import { useToast } from "@web/components/Toast/useToast";
import { useLatestRef } from "@web/hooks/useLatestRef";
import { useTranslation } from "react-i18next";
import {
  InboxArchivedFilters,
  type InboxArchivedFilter,
  type InboxSort,
  InboxLayouts,
  type InboxLayout,
} from "types/inbox";

import { FIRST_LOAD_SETTLE_MS, MATCHING_CAP } from "../../consts";
import type { InboxItem, InboxQueryParams } from "../../types";
import { readRowKey, splitAtFold } from "../../utils";
import { DeleteModal } from "./DeleteModal";
import styles from "./InboxList.module.scss";
import { InboxRow } from "./InboxRow";
import { PurgeAttachmentsModal } from "./PurgeAttachmentsModal";
import { SelectionHeader } from "./SelectionHeader";
import { ArchiveScopes, type ArchiveScope } from "./types";
import { useInboxArchive } from "./useInboxArchive";
import { useInboxCursor } from "./useInboxCursor";
import { useInboxDeleteFacade } from "./useInboxDeleteFacade";
import { useInboxPurgeFacade } from "./useInboxPurgeFacade";
import { useInboxSelection } from "./useInboxSelection";
import { useKeepCursorFocus } from "./useKeepCursorFocus";
import { focusCursorRow, listMatchingRows, readSelectionText } from "./utils";

const NO_PARAMS: InboxQueryParams = {};

export interface InboxListProps {
  items: readonly InboxItem[];
  sort: InboxSort;
  /** Folded splits the rows at the fold; mixed keeps them in the sort's order. */
  layout: InboxLayout;
  /** The Inbox, or the viewer's archived rows. */
  archived?: InboxArchivedFilter;
  /** The list's query, for reading every matching row beyond this page. */
  params?: InboxQueryParams;
  /** Rows matching the filters across every page. */
  total?: number;
  pageSize?: number;
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
 * and the Toast on the heading's line says what a row action did, with
 * Undo after an archive.
 */
export function InboxList({
  items,
  sort,
  layout,
  archived = InboxArchivedFilters.HIDE,
  pageKey = "",
  params = NO_PARAMS,
  total = 0,
  pageSize = 1,
  controls,
  children,
}: InboxListProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const firstLoad = useFirstLoad();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cursorRowRef = useRef<HTMLLIElement>(null);
  const listsRef = useRef<HTMLDivElement>(null);
  const toast = useToast();
  const { above, below } =
    layout === InboxLayouts.FOLDED
      ? splitAtFold(items)
      : { above: items, below: [] };
  const ordered = [...above, ...below];
  const selection = useInboxSelection(ordered);
  const rowKeys = ordered.map(readRowKey);
  const cursor = useInboxCursor(
    rowKeys,
    listsRef,
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
        handleSelect(item, !selection.isSelected(item));
      }
    },
  );
  const [allMatching, setAllMatching] = useState(false);
  const [collecting, setCollecting] = useState(false);
  // Touch has no hover to reveal a box, so the Select button enters this.
  const [selectMode, setSelectMode] = useState(false);
  // A matching read answers for the scope it started in: any change to the
  // scope moves the generation, and a read from an older one is dropped.
  const readGeneration = useRef(0);
  const { clear: clearSelection, setSelected } = selection;
  // The selection belongs to one page of one search; the URL is outside React.
  // Mount clears nothing: a box ticked before hydration lands in its effect first.
  const selectedPageKey = useRef(pageKey);
  useEffect(() => {
    if (selectedPageKey.current === pageKey) {
      return;
    }
    selectedPageKey.current = pageKey;
    readGeneration.current += 1;
    clearSelection();
    setAllMatching(false);
    setSelectMode(false);
  }, [pageKey, clearSelection]);
  // One row's tick or untick narrows the scope back to the page's ticks.
  const handleSelect = useCallback(
    (item: InboxItem, checked: boolean, range?: boolean): void => {
      readGeneration.current += 1;
      setAllMatching(false);
      setSelected(item, checked, range);
    },
    [setSelected],
  );
  const now = new Date();
  const showFold = above.length > 0 && below.length > 0;

  // Keyed on key moves: a re-read that shifts or removes the row never
  // scrolls, and moves focus only to give back what it dropped.
  useEffect(() => {
    if (cursorRowRef.current !== null) {
      focusCursorRow(cursorRowRef.current);
    }
  }, [cursor.moveCount]);

  // The row's menu returns focus to its trigger as it leaves; the heading
  // takes it on the next frame, and keeps it once the row is gone.
  const focusHeading = useCallback((options?: FocusOptions): void => {
    window.requestAnimationFrame(() => headingRef.current?.focus(options));
  }, []);

  const { handleRowFocus, handleListsFocus, handleListsBlur } =
    useKeepCursorFocus({
      listsRef,
      cursorRowRef,
      cursorRowKey: rowKeys[cursor.index],
      rowsLayout: `${above.map(readRowKey).join(" ")}|${below.map(readRowKey).join(" ")}`,
      setCursorRow: cursor.setCursorRow,
      focusHeading,
    });
  function handleRowFocusIn(item: InboxItem): void {
    handleRowFocus(readRowKey(item));
  }
  // The ticks come off the rows that went before the re-read lands, so the
  // bar never offers those rows again while the list still shows them.
  const { remove: removeSelected } = selection;
  const handleGone = useCallback(
    (gone: readonly InboxItem[]): void => {
      removeSelected(gone);
      setAllMatching(false);
      focusHeading();
    },
    [focusHeading, removeSelected],
  );
  // Only the selection bar's actions end select mode; a row's own menu keeps it.
  const handleSelectionGone = useCallback(
    (gone: readonly InboxItem[]): void => {
      handleGone(gone);
      setSelectMode(false);
    },
    [handleGone],
  );
  const handleRowGone = useCallback(
    (item: InboxItem): void => handleGone([item]),
    [handleGone],
  );
  // One delete modal serves a row's menu and the selection bar.
  const handleDeleted = useCallback(
    (gone: readonly InboxItem[], scope: ArchiveScope): void => {
      if (scope === ArchiveScopes.SELECTION) {
        handleSelectionGone(gone);
      } else {
        handleGone(gone);
      }
    },
    [handleGone, handleSelectionGone],
  );
  const deletion = useInboxDeleteFacade({
    announce: toast.show,
    onDeleted: handleDeleted,
  });
  // The Undo whose restore is running; an archive made since keeps its own.
  const restoreSource = useRef<ToastAction | undefined>(undefined);
  const { showOutcome } = toast;
  const restoring = useInboxArchive({
    scope: ArchiveScopes.SELECTION,
    announce: (message) => {
      showOutcome(message, restoreSource.current);
    },
    announceRestoreFailed: (message, failed) => {
      showOutcome(message, restoreSource.current, buildUndo(failed));
    },
    onRemoved: keepRestoredRows,
  });
  const latestRestore = useLatestRef(restoring.archive);
  const showToast = toast.show;
  // The row that held the action may be gone by now, so the way back lives here.
  const buildUndo = useCallback(
    (gone: readonly InboxItem[]): ToastAction => {
      const undo: ToastAction = {
        label: t("home.inbox.actions.undo"),
        hint: t("home.inbox.actions.undoHint"),
        run: () => {
          restoreSource.current = undo;
          headingRef.current?.focus();
          void latestRestore.current(gone, InboxArchivedFilters.ONLY);
        },
      };
      return undo;
    },
    [latestRestore, t],
  );
  const announceArchived = useCallback(
    (message: string, gone: readonly InboxItem[]): void => {
      showToast(message, buildUndo(gone));
    },
    [buildUndo, showToast],
  );
  const archiving = useInboxArchive({
    scope: ArchiveScopes.SELECTION,
    announce: toast.show,
    announceArchived,
    onRemoved: handleSelectionGone,
  });
  const purge = useInboxPurgeFacade({ announce: toast.show });
  const { requestDelete } = deletion;
  const handleDelete = useCallback(
    (item: InboxItem): void => {
      requestDelete([item], ArchiveScopes.ROW);
    },
    [requestDelete],
  );
  const deletable = selection.selectedItems.filter(
    (item) => item.viewerCanDelete,
  );
  // One restore at a time: a second archive's Undo would meet the guard and do nothing.
  const archiveHeld = restoring.pending;
  const busy = deletion.busy || archiving.pending || archiveHeld || collecting;
  const deleteOpen = deletion.pending !== undefined;
  const deleteItems = deletion.pending?.items ?? NO_ROWS;
  const selectedCount = selection.selectedItems.length;
  const selecting = selectMode || selectedCount > 0;
  const matchingTotal = Math.max(total, ordered.length);
  const selectionText = readSelectionText(t, {
    selectedCount,
    allMatching,
    total: matchingTotal,
    cap: MATCHING_CAP,
  });

  // Every matching row, this page's ticks included, read page by page and
  // capped; the tally names what the read reached. Nothing comes back when
  // the scope moved under the read, or when its first page failed.
  async function collectSelected(): Promise<readonly InboxItem[] | undefined> {
    if (!allMatching) {
      return selection.selectedItems;
    }
    const generation = readGeneration.current;
    setCollecting(true);
    try {
      const rows = await listMatchingRows(queryClient, {
        params,
        total: matchingTotal,
        pageSize,
        cap: MATCHING_CAP,
      });
      if (generation !== readGeneration.current) {
        toast.show(t("home.inbox.select.readDropped"));
        return undefined;
      }
      if (rows.length === 0) {
        toast.show(t("home.inbox.select.readFailed"));
        return undefined;
      }
      return rows;
    } finally {
      setCollecting(false);
    }
  }

  function confirmPurge(): void {
    void purge.confirm();
  }

  function confirmDelete(): void {
    void deletion.confirm();
  }
  async function runArchive(): Promise<void> {
    const rows = await collectSelected();
    if (rows !== undefined) {
      await archiving.archive(rows, archived);
    }
  }
  async function runBulkDelete(): Promise<void> {
    const rows = await collectSelected();
    if (rows === undefined) {
      return;
    }
    const deletableRows = rows.filter((item) => item.viewerCanDelete);
    if (deletableRows.length === 0) {
      toast.show(t("home.inbox.select.noneDeletable", { count: rows.length }));
      return;
    }
    deletion.requestDelete(deletableRows, ArchiveScopes.SELECTION);
  }
  function archiveSelected(): void {
    void runArchive();
  }
  function requestBulkDelete(): void {
    void runBulkDelete();
  }
  function selectPage(checked: boolean): void {
    readGeneration.current += 1;
    setAllMatching(false);
    selection.selectPage(checked);
  }
  function selectAllMatching(): void {
    setAllMatching(true);
  }
  function startSelecting(): void {
    setSelectMode(true);
  }
  function clearAllMatching(): void {
    readGeneration.current += 1;
    setAllMatching(false);
  }
  // Clear unmounts the actions under the focused button; the heading takes it.
  function handleClear(): void {
    readGeneration.current += 1;
    selection.clear();
    setAllMatching(false);
    setSelectMode(false);
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
        <Toast
          action={toast.action}
          aside={toast.aside}
          actionDisabled={restoring.pending}
          message={toast.message}
          shown={toast.shown}
          testId="inbox-toast"
          onActionLeft={focusHeading}
          onHold={toast.hold}
          onRelease={toast.release}
        />
        {controls}
      </div>
      {children}
      <div
        className={styles["lists"]}
        data-first-load={firstLoad}
        hidden={ordered.length === 0}
        onBlur={handleListsBlur}
        onFocus={handleListsFocus}
        ref={listsRef}
      >
        <SelectionHeader
          allMatching={allMatching}
          allSelected={selection.allSelected}
          archived={archived}
          busy={busy}
          cap={MATCHING_CAP}
          deletableCount={deletable.length}
          pageCount={ordered.length}
          selectedCount={selectedCount}
          selecting={selecting}
          someSelected={selection.someSelected}
          takeFocus={selectMode}
          total={matchingTotal}
          onArchive={archiveSelected}
          onClear={handleClear}
          onClearAllMatching={clearAllMatching}
          onDelete={requestBulkDelete}
          onSelectAllMatching={selectAllMatching}
          onSelectPage={selectPage}
          onStartSelecting={startSelecting}
        />
        {above.length === 0 ? null : (
          <ol className={styles["list"]}>
            {above.map((item, index) => (
              <InboxRow
                cursor={index === cursor.index}
                index={index}
                item={item}
                key={readRowKey(item)}
                now={now}
                rowRef={index === cursor.index ? cursorRowRef : undefined}
                selected={selection.isSelected(item)}
                selecting={selecting}
                sort={sort}
                archived={archived}
                archiveHeld={archiveHeld}
                deleteHeld={collecting}
                onAnnounce={toast.show}
                onArchived={announceArchived}
                onDelete={handleDelete}
                onPurgeAttachments={purge.requestPurge}
                onFocusRow={handleRowFocusIn}
                onRemoved={handleRowGone}
                onSelectRow={handleSelect}
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
                cursor={above.length + index === cursor.index}
                index={above.length + index}
                item={item}
                key={readRowKey(item)}
                now={now}
                rowRef={
                  above.length + index === cursor.index
                    ? cursorRowRef
                    : undefined
                }
                selected={selection.isSelected(item)}
                selecting={selecting}
                sort={sort}
                archived={archived}
                archiveHeld={archiveHeld}
                deleteHeld={collecting}
                onAnnounce={toast.show}
                onArchived={announceArchived}
                onDelete={handleDelete}
                onPurgeAttachments={purge.requestPurge}
                onFocusRow={handleRowFocusIn}
                onRemoved={handleRowGone}
                onSelectRow={handleSelect}
              />
            ))}
          </ol>
        )}
      </div>
      <DeleteModal
        busy={deletion.busy}
        cancel={deletion.cancel}
        confirm={confirmDelete}
        items={deleteItems}
        open={deleteOpen}
      />
      {purge.pending === undefined ? null : (
        <PurgeAttachmentsModal
          busy={purge.busy}
          cancel={purge.cancel}
          confirm={confirmPurge}
          item={purge.pending}
        />
      )}
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

const NO_ROWS: readonly InboxItem[] = [];

function keepRestoredRows(): void {}

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
