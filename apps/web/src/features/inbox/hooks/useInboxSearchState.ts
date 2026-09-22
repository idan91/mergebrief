import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";

import {
  clearInboxFilters,
  parseInboxSearch,
  readInboxChoices,
  readLastPage,
  writeInboxSearch,
  type InboxChoices,
} from "../search";
import type { InboxSearch, InboxSearchChange } from "../types";

const HOME_PATH = "/";

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
  const choices: InboxChoices = readInboxChoices(search);

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
    if (!pastTheEnd || lastPage === undefined) return;
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
    clear: () => {
      void navigate({
        to: HOME_PATH,
        replace: true,
        search: (previous: InboxSearch) =>
          clearInboxFilters(parseInboxSearch({ ...previous })),
      });
    },
  };
}
