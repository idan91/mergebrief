import { useNavigate, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  clearInboxFilters,
  dropPendingSearchText,
  parseInboxSearch,
  readInboxChoices,
  readLastPage,
  writeInboxSearch,
  type InboxChoices,
} from "../search";
import type {
  InboxSearch,
  InboxSearchChange,
  SearchTextOverride,
} from "../types";

const HOME_PATH = "/";
const NO_SEARCH_TEXT_OVERRIDE: SearchTextOverride = { count: 0, text: "" };
/** The history action every write here makes; any other is someone else's navigation. */
const WRITE_ACTION = "REPLACE";

function stepOverride(
  previous: SearchTextOverride,
  text: string,
): SearchTextOverride {
  return { count: previous.count + 1, text };
}

/** A change, or one derived from the choices the URL holds at the moment it is written. */
export type InboxSearchWrite =
  | InboxSearchChange
  | ((live: InboxChoices) => InboxSearchChange);

/**
 * The list's state lives in the URL and nowhere else: every change is
 * written with `replace` against the URL as it is when the write lands,
 * never the one this render saw, so two ticks before the list settles both
 * count. A filter or sort change starts over from page one, and a page
 * past the end is replaced by the last page once the total is known.
 */
export function useInboxSearchState(
  search: InboxSearch,
  total: number | undefined,
  pageSize: number | undefined,
) {
  const navigate = useNavigate();
  const router = useRouter();
  const [searchTextOverride, setSearchTextOverride] = useState(
    NO_SEARCH_TEXT_OVERRIDE,
  );
  const choices: InboxChoices = readInboxChoices(search);

  // A Back, a Forward or a link onto Home supersedes whatever the search
  // field has on its way to the URL, and can land on a text the URL already
  // showed, so the URL alone never tells the field. History does.
  useEffect(
    () =>
      router.history.subscribe(({ location, action }) => {
        if (action.type === WRITE_ACTION) {
          return;
        }
        const target = router.parseLocation(location);
        if (target.pathname !== HOME_PATH) {
          return;
        }
        const targetSearch = parseInboxSearch({ ...target.search });
        const targetText = readInboxChoices(targetSearch).searchText;
        setSearchTextOverride((previous) => stepOverride(previous, targetText));
      }),
    [router],
  );

  function write(next: InboxSearchWrite): void {
    void navigate({
      to: HOME_PATH,
      replace: true,
      search: (previous: InboxSearch) => {
        const current = parseInboxSearch({ ...previous });
        const change =
          typeof next === "function" ? next(readInboxChoices(current)) : next;
        return writeInboxSearch(current, change);
      },
    });
  }

  const lastPage =
    total === undefined || pageSize === undefined
      ? undefined
      : readLastPage(total, pageSize);
  const pastTheEnd = lastPage !== undefined && choices.page > lastPage;
  useEffect(() => {
    if (!pastTheEnd || lastPage === undefined) {
      return;
    }
    void navigate({
      to: HOME_PATH,
      replace: true,
      search: (previous: InboxSearch) =>
        writeInboxSearch(parseInboxSearch({ ...previous }), { page: lastPage }),
    });
  }, [pastTheEnd, lastPage, navigate]);

  return {
    choices,
    write,
    /**
     * Put the search text back to the one on screen. The search still
     * loading is dropped and the loader cancels its read; a filter change
     * loading beside it stays.
     */
    dropPendingSearchText: () => {
      void navigate({
        to: HOME_PATH,
        replace: true,
        resetScroll: false,
        search: (previous: InboxSearch) =>
          dropPendingSearchText(parseInboxSearch({ ...previous }), search),
      });
    },
    /** Stepped by every Clear and every navigation onto Home that is not a write here. */
    searchTextOverride,
    clear: () => {
      setSearchTextOverride((previous) => stepOverride(previous, ""));
      void navigate({
        to: HOME_PATH,
        replace: true,
        search: (previous: InboxSearch) =>
          clearInboxFilters(parseInboxSearch({ ...previous })),
      });
    },
  };
}
