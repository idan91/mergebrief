import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod/v4";

import {
  readCookieValue,
  writePreferenceCookie,
} from "@web/utils/preference-cookie";
import { SidebarTabs, type SidebarPreference } from "./types";

/** The cookie the preference lives in: the server renders the sidebar with it. */
export const SIDEBAR_COOKIE = "mergebrief.sidebar";

/** The preference's localStorage home before the cookie, read once to seed it. */
export const LEGACY_SIDEBAR_STORAGE_KEY = "mergebrief.sidebar";

/**
 * Whether the last load found the viewport in the range where an open panel
 * overlays the story. The server cannot measure the viewport, so it renders
 * the sidebar closed where this says the last one would have been.
 */
export const SIDEBAR_OVERLAY_COOKIE = "mergebrief.sidebarOverlay";

const OVERLAY_HINT_SET = "1";
const OVERLAY_HINT_UNSET = "0";

export const DEFAULT_SIDEBAR_PREFERENCE: SidebarPreference = {
  expanded: false,
  tab: SidebarTabs.THIS_PR,
};

// Each field falls back on its own: a remembered tab this build no longer
// ships must not also forget whether the sidebar was open.
const sidebarPreferenceSchema = z.object({
  expanded: z.boolean().catch(DEFAULT_SIDEBAR_PREFERENCE.expanded),
  tab: z.enum(SidebarTabs).catch(DEFAULT_SIDEBAR_PREFERENCE.tab),
});

function parseStoredJson(json: string): SidebarPreference {
  try {
    const parsed = sidebarPreferenceSchema.safeParse(JSON.parse(json));
    return parsed.success ? parsed.data : DEFAULT_SIDEBAR_PREFERENCE;
  } catch {
    return DEFAULT_SIDEBAR_PREFERENCE;
  }
}

/** The cookie's value is the preference as URI-encoded JSON. */
export function parseSidebarPreference(
  raw: string | undefined,
): SidebarPreference {
  if (raw === undefined) {
    return DEFAULT_SIDEBAR_PREFERENCE;
  }
  try {
    return parseStoredJson(decodeURIComponent(raw));
  } catch {
    return DEFAULT_SIDEBAR_PREFERENCE;
  }
}

/**
 * The stored preference on whichever side renders: the request's cookie on
 * the server, the document's in the browser, so both first renders agree.
 */
export const readSidebarPreference = createIsomorphicFn()
  .server(
    (): SidebarPreference => parseSidebarPreference(getCookie(SIDEBAR_COOKIE)),
  )
  .client(
    (): SidebarPreference =>
      parseSidebarPreference(readCookieValue(document.cookie, SIDEBAR_COOKIE)),
  );

export function writeSidebarPreference(preference: SidebarPreference): void {
  writePreferenceCookie(
    SIDEBAR_COOKIE,
    encodeURIComponent(JSON.stringify(preference)),
  );
}

export const readSidebarOverlayHint = createIsomorphicFn()
  .server((): boolean => getCookie(SIDEBAR_OVERLAY_COOKIE) === OVERLAY_HINT_SET)
  .client(
    (): boolean =>
      readCookieValue(document.cookie, SIDEBAR_OVERLAY_COOKIE) ===
      OVERLAY_HINT_SET,
  );

/** Written on change only: most loads find the viewport where the last one did. */
export function writeSidebarOverlayHint(overlaysStory: boolean): void {
  if (typeof document === "undefined") {
    return;
  }
  const next = overlaysStory ? OVERLAY_HINT_SET : OVERLAY_HINT_UNSET;
  if (readCookieValue(document.cookie, SIDEBAR_OVERLAY_COOKIE) === next) {
    return;
  }
  writePreferenceCookie(SIDEBAR_OVERLAY_COOKIE, next);
}

/** What shows on a load: a stored open panel stays closed where it would overlay the story. */
export function resolveShownPreference(
  stored: SidebarPreference,
  overlaysStory: boolean,
): SidebarPreference {
  return overlaysStory ? { ...stored, expanded: false } : stored;
}

/**
 * Moves a preference stored before the cookie into it, once: what it held,
 * or absent when the cookie is already set or nothing was stored.
 */
export function migrateLegacySidebarPreference():
  | SidebarPreference
  | undefined {
  const hasCookie =
    readCookieValue(document.cookie, SIDEBAR_COOKIE) !== undefined;
  if (hasCookie) {
    return undefined;
  }

  try {
    const raw = window.localStorage.getItem(LEGACY_SIDEBAR_STORAGE_KEY);
    if (raw === null) {
      return undefined;
    }
    window.localStorage.removeItem(LEGACY_SIDEBAR_STORAGE_KEY);
    const preference = parseStoredJson(raw);
    writeSidebarPreference(preference);
    return preference;
  } catch {
    return undefined;
  }
}
