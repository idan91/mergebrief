import type { QueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";

import { buildInboxQueryOptions } from "../../queries";
import {
  InboxStates,
  type InboxItem,
  type InboxQueryParams,
} from "../../types";
import { readRowKey } from "../../utils";
import { ArchiveScopes, type ArchiveScope } from "./types";

export interface MatchingRowsInput {
  readonly params: InboxQueryParams;
  /** Rows matching the filters across every page. */
  readonly total: number;
  readonly pageSize: number;
  /** The most rows answered; the pages past it are never read. */
  readonly cap: number;
}

/**
 * Every row the filters match, read page by page through the same query
 * the list uses, so a cached page costs nothing. A page that fails or
 * will not parse ends the read: the rows so far are answered, and the
 * action's tally says how many it reached.
 */
export async function listMatchingRows(
  queryClient: QueryClient,
  input: MatchingRowsInput,
): Promise<readonly InboxItem[]> {
  const wanted = Math.min(input.total, input.cap);
  const pages = Math.ceil(wanted / Math.max(input.pageSize, 1));
  const seen = new Set<string>();
  const rows: InboxItem[] = [];

  for (let page = 1; page <= pages; page += 1) {
    // Sequential on purpose: each page is one request on the viewer's token.
    // eslint-disable-next-line no-await-in-loop
    const state = await queryClient
      .fetchQuery(buildInboxQueryOptions({ ...input.params, page }))
      .catch(() => undefined);
    if (state === undefined || state.kind !== InboxStates.READY) {
      break;
    }
    for (const item of state.page.items) {
      const key = readRowKey(item);
      if (!seen.has(key)) {
        seen.add(key);
        rows.push(item);
      }
    }
  }
  return rows.slice(0, wanted);
}

export interface SelectionTextInput {
  readonly selectedCount: number;
  readonly allMatching: boolean;
  readonly total: number;
  readonly cap: number;
}

/** The live region's line: nothing, the count, or the whole match. */
export function readSelectionText(
  t: TFunction,
  input: SelectionTextInput,
): string {
  if (input.allMatching) {
    return input.cap < input.total
      ? t("home.inbox.select.firstMatching", {
          cap: input.cap,
          count: input.total,
        })
      : t("home.inbox.select.allMatching", { count: input.total });
  }
  if (input.selectedCount === 0) {
    return t("home.inbox.select.none");
  }
  return t("home.inbox.select.count", { count: input.selectedCount });
}

export interface ArchiveOutcome {
  readonly scope: ArchiveScope;
  /** An unarchive, from the archived view. */
  readonly restoring: boolean;
  /** Rows that went. */
  readonly done: number;
  /** Rows asked for. */
  readonly total: number;
  /** A write got no answer, so the rows that did not go may have gone anyway. */
  readonly indeterminate: boolean;
}

/** A row's menu answers in the row's own words; the selection bar answers with a count or a tally. */
export function describeArchiveOutcome(
  t: TFunction,
  outcome: ArchiveOutcome,
): string {
  const { restoring, done, total, indeterminate } = outcome;
  const failed = total - done;
  if (outcome.scope === ArchiveScopes.ROW) {
    if (failed === 0) {
      const rowDone = restoring
        ? t("home.inbox.actions.unarchived")
        : t("home.inbox.actions.archived");
      return rowDone;
    }
    if (indeterminate) {
      const rowUnconfirmed = restoring
        ? t("home.inbox.actions.unarchiveIndeterminate")
        : t("home.inbox.actions.archiveIndeterminate");
      return rowUnconfirmed;
    }
    const rowFailed = restoring
      ? t("home.inbox.actions.unarchiveFailed")
      : t("home.inbox.actions.archiveFailed");
    return rowFailed;
  }

  if (failed === 0) {
    const allDone = restoring
      ? t("home.inbox.actions.unarchivedMany", { count: done })
      : t("home.inbox.actions.archivedMany", { count: done });
    return allDone;
  }
  if (indeterminate) {
    const someUnconfirmed = restoring
      ? t("home.inbox.actions.unarchivedIndeterminate", { done, total })
      : t("home.inbox.actions.archivedIndeterminate", { done, total });
    return someUnconfirmed;
  }
  const tally = { done, total, failed };
  const someDone = restoring
    ? t("home.inbox.actions.unarchivedSome", tally)
    : t("home.inbox.actions.archivedSome", tally);
  return someDone;
}
