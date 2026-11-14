import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod/v4";

import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import {
  readCookieValue,
  writePreferenceCookie,
} from "@web/utils/preference-cookie";

/** The cookie the preference lives in: the server renders with it. */
export const DIFF_VIEW_COOKIE = "mergebrief.diffView";

/** The preference's localStorage home before the cookie, read once to seed it. */
export const LEGACY_DIFF_VIEW_STORAGE_KEY = "mergebrief.diffView";

// A view this build no longer ships must not strand the reader on a blank
// preference; the catch lands them back on the default.
const diffViewSchema = z.enum(DiffViews).catch(DiffViews.UNIFIED);

export function parseDiffView(raw: string | undefined): DiffView {
  return diffViewSchema.parse(raw);
}

/**
 * The stored view on whichever side renders: the request's cookie on the
 * server, the document's in the browser, so both first renders agree.
 */
export const readDiffView = createIsomorphicFn()
  .server((): DiffView => parseDiffView(getCookie(DIFF_VIEW_COOKIE)))
  .client(
    (): DiffView =>
      parseDiffView(readCookieValue(document.cookie, DIFF_VIEW_COOKIE)),
  );

export function writeDiffView(view: DiffView): void {
  writePreferenceCookie(DIFF_VIEW_COOKIE, view);
}

/**
 * Moves a preference stored before the cookie into it, once: the view it
 * held, or absent when the cookie is already set or nothing was stored.
 */
export function migrateLegacyDiffView(): DiffView | undefined {
  const hasCookie =
    readCookieValue(document.cookie, DIFF_VIEW_COOKIE) !== undefined;
  if (hasCookie) {
    return undefined;
  }

  try {
    const raw = window.localStorage.getItem(LEGACY_DIFF_VIEW_STORAGE_KEY);
    if (raw === null) {
      return undefined;
    }
    window.localStorage.removeItem(LEGACY_DIFF_VIEW_STORAGE_KEY);
    const view = diffViewSchema.parse(JSON.parse(raw));
    writeDiffView(view);
    return view;
  } catch {
    return undefined;
  }
}

/** A deep link names the view outright; otherwise the viewer's own preference. */
export function resolveDiffView(
  search: DiffView | undefined,
  stored: DiffView,
): DiffView {
  return search ?? stored;
}
