import { createIsomorphicFn } from "@tanstack/react-start";
import { getCookie } from "@tanstack/react-start/server";
import { z } from "zod/v4";

import {
  clearPreferenceCookie,
  readCookieValue,
  writePreferenceCookie,
} from "@web/utils/preference-cookie";

/** The cookie the width lives in: the server renders the card column with it. */
export const STORY_CARD_TRACK_COOKIE = "mergebrief.storyCardTrack";

/** The width's localStorage home before the cookie, read once to seed it. */
export const LEGACY_STORY_CARD_TRACK_STORAGE_KEY = "mergebrief.storyCardTrack";

// Bounds live in the CSS clamp; storage only refuses shapes that are not a
// pixel count at all.
const storyCardTrackSchema = z.coerce.number().int().positive();

export function parseStoryCardTrack(
  raw: string | undefined,
): number | undefined {
  if (raw === undefined || raw.trim() === "") {
    return undefined;
  }
  const parsed = storyCardTrackSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
}

/**
 * The stored width on whichever side renders: the request's cookie on the
 * server, the document's in the browser, so both first renders agree.
 */
export const readStoryCardTrack = createIsomorphicFn()
  .server((): number | undefined =>
    parseStoryCardTrack(getCookie(STORY_CARD_TRACK_COOKIE)),
  )
  .client((): number | undefined =>
    parseStoryCardTrack(
      readCookieValue(document.cookie, STORY_CARD_TRACK_COOKIE),
    ),
  );

export function writeStoryCardTrack(px: number): void {
  writePreferenceCookie(STORY_CARD_TRACK_COOKIE, String(px));
}

export function clearStoryCardTrack(): void {
  clearPreferenceCookie(STORY_CARD_TRACK_COOKIE);
}

/**
 * Moves a width stored before the cookie into it, once: the width it held,
 * or absent when the cookie is already set or nothing usable was stored.
 */
export function migrateLegacyStoryCardTrack(): number | undefined {
  const hasCookie =
    readCookieValue(document.cookie, STORY_CARD_TRACK_COOKIE) !== undefined;
  if (hasCookie) {
    return undefined;
  }

  try {
    const raw = window.localStorage.getItem(
      LEGACY_STORY_CARD_TRACK_STORAGE_KEY,
    );
    if (raw === null) {
      return undefined;
    }
    window.localStorage.removeItem(LEGACY_STORY_CARD_TRACK_STORAGE_KEY);
    const track = parseStoryCardTrack(raw);
    if (track !== undefined) {
      writeStoryCardTrack(track);
    }
    return track;
  } catch {
    return undefined;
  }
}
