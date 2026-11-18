import { InboxArchivedFilters } from "types/inbox";

import {
  EVERY_STATUS_PARAM,
  hasDefaultStatus,
  widenInboxFilters,
  type InboxChoices,
} from "../../search";
import type { InboxPage, InboxSearch, InboxSearchChange } from "../../types";
import { readSearchMissReason } from "../../utils";
import { EmptyInbox, type EmptyInboxProps } from "../EmptyInbox";
import { SearchMiss } from "../SearchMiss";

export interface MissingRowsProps {
  page: InboxPage;
  search: InboxSearch;
  choices: InboxChoices;
  /** Why no row shows while rows exist. */
  emptiness: EmptyInboxProps["reason"];
  onWrite: (change: InboxSearchChange) => void;
  onClear: () => void;
  /** A search miss action ran; its button leaves with the miss, so focus needs a node that stays. */
  onSearchMissAction: () => void;
}

/**
 * What stands where the rows would be: why a search shows none, with the
 * way to its matches; else why the filters or the view show none.
 */
export function MissingRows({
  page,
  search,
  choices,
  emptiness,
  onWrite,
  onClear,
  onSearchMissAction,
}: MissingRowsProps) {
  const archivedView = choices.archived === InboxArchivedFilters.ONLY;
  const otherView = archivedView
    ? InboxArchivedFilters.HIDE
    : InboxArchivedFilters.ONLY;
  const missReason = readSearchMissReason(
    page,
    choices.searchText,
    choices.archived,
  );

  function writeFromMiss(change: InboxSearchChange): void {
    onWrite(change);
    onSearchMissAction();
  }

  if (missReason !== undefined) {
    return (
      <SearchMiss
        archivedView={archivedView}
        reason={missReason}
        searchText={choices.searchText}
        onClearSearch={() => writeFromMiss({ q: undefined })}
        onShowAllMatches={() =>
          writeFromMiss(widenInboxFilters(choices.archived))
        }
        onShowOtherView={() => writeFromMiss(widenInboxFilters(otherView))}
      />
    );
  }
  return (
    <EmptyInbox
      archivedTotal={page.archivedTotal}
      defaultStatus={hasDefaultStatus(search)}
      reason={emptiness}
      onClear={onClear}
      onShowArchived={() => onWrite({ archived: InboxArchivedFilters.ONLY })}
      onShowHidden={() => onWrite({ state: EVERY_STATUS_PARAM })}
      onShowInbox={() => onWrite({ archived: undefined })}
    />
  );
}
