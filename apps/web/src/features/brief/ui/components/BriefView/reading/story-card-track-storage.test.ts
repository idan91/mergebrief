// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { readCookieValue } from "@web/utils/preference-cookie";
import {
  LEGACY_STORY_CARD_TRACK_STORAGE_KEY,
  STORY_CARD_TRACK_COOKIE,
  clearStoryCardTrack,
  migrateLegacyStoryCardTrack,
  parseStoryCardTrack,
  readStoryCardTrack,
  writeStoryCardTrack,
} from "./story-card-track-storage";

function readCookie(): string | undefined {
  return readCookieValue(document.cookie, STORY_CARD_TRACK_COOKIE);
}

afterEach(() => {
  clearStoryCardTrack();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("parseStoryCardTrack", () => {
  it("reads nothing when nothing is stored", () => {
    expect(parseStoryCardTrack(undefined)).toBeUndefined();
  });

  it("reads a positive integer", () => {
    expect(parseStoryCardTrack("512")).toBe(512);
  });

  it("reads nothing on an empty value", () => {
    expect(parseStoryCardTrack("")).toBeUndefined();
  });

  it("reads nothing on text", () => {
    expect(parseStoryCardTrack("wide")).toBeUndefined();
  });

  it("reads nothing on a negative number", () => {
    expect(parseStoryCardTrack("-40")).toBeUndefined();
  });

  it("reads nothing on a fraction", () => {
    expect(parseStoryCardTrack("412.5")).toBeUndefined();
  });
});

describe("readStoryCardTrack", () => {
  it("reads nothing without the cookie", () => {
    expect(readStoryCardTrack()).toBeUndefined();
  });

  it("reads the width from the document's cookie", () => {
    writeStoryCardTrack(480);
    expect(readStoryCardTrack()).toBe(480);
  });
});

describe("writeStoryCardTrack", () => {
  it("stores the px count in the cookie", () => {
    writeStoryCardTrack(480);
    expect(readCookie()).toBe("480");
  });
});

describe("clearStoryCardTrack", () => {
  it("removes the stored width", () => {
    writeStoryCardTrack(480);
    clearStoryCardTrack();
    expect(readCookie()).toBeUndefined();
  });
});

describe("migrateLegacyStoryCardTrack", () => {
  it("moves a width stored before the cookie into it, once", () => {
    window.localStorage.setItem(LEGACY_STORY_CARD_TRACK_STORAGE_KEY, "600");

    expect(migrateLegacyStoryCardTrack()).toBe(600);
    expect(readCookie()).toBe("600");
    expect(
      window.localStorage.getItem(LEGACY_STORY_CARD_TRACK_STORAGE_KEY),
    ).toBeNull();
    expect(migrateLegacyStoryCardTrack()).toBeUndefined();
  });

  it("leaves a cookie already set alone", () => {
    writeStoryCardTrack(480);
    window.localStorage.setItem(LEGACY_STORY_CARD_TRACK_STORAGE_KEY, "600");

    expect(migrateLegacyStoryCardTrack()).toBeUndefined();
    expect(readCookie()).toBe("480");
  });

  it("drops a stored value that is not a width", () => {
    window.localStorage.setItem(
      LEGACY_STORY_CARD_TRACK_STORAGE_KEY,
      "{not json",
    );

    expect(migrateLegacyStoryCardTrack()).toBeUndefined();
    expect(readCookie()).toBeUndefined();
  });

  it("migrates nothing when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(migrateLegacyStoryCardTrack()).toBeUndefined();
  });
});
