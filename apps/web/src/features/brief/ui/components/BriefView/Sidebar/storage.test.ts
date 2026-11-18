// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearPreferenceCookie,
  readCookieValue,
} from "@web/utils/preference-cookie";
import {
  DEFAULT_SIDEBAR_PREFERENCE,
  LEGACY_SIDEBAR_STORAGE_KEY,
  migrateLegacySidebarPreference,
  parseSidebarPreference,
  readSidebarOverlayHint,
  readSidebarPreference,
  resolveShownPreference,
  SIDEBAR_COOKIE,
  SIDEBAR_OVERLAY_COOKIE,
  writeSidebarOverlayHint,
  writeSidebarPreference,
} from "./storage";

function encodePreference(value: unknown): string {
  return encodeURIComponent(JSON.stringify(value));
}

afterEach(() => {
  clearPreferenceCookie(SIDEBAR_COOKIE);
  clearPreferenceCookie(SIDEBAR_OVERLAY_COOKIE);
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("parseSidebarPreference", () => {
  it("defaults to collapsed on This PR when nothing is stored", () => {
    expect(parseSidebarPreference(undefined)).toEqual(
      DEFAULT_SIDEBAR_PREFERENCE,
    );
  });

  it("reads a stored preference", () => {
    const raw = encodePreference({ expanded: true, tab: "this-pr" });
    expect(parseSidebarPreference(raw)).toEqual({
      expanded: true,
      tab: "this-pr",
    });
  });

  it("defaults on corrupt JSON", () => {
    expect(parseSidebarPreference("%7Bnot%20json")).toEqual(
      DEFAULT_SIDEBAR_PREFERENCE,
    );
  });

  it("defaults on a value that does not decode", () => {
    expect(parseSidebarPreference("%E0%A4%A")).toEqual(
      DEFAULT_SIDEBAR_PREFERENCE,
    );
  });

  it("defaults on a non-object", () => {
    expect(parseSidebarPreference(encodePreference(42))).toEqual(
      DEFAULT_SIDEBAR_PREFERENCE,
    );
  });

  it("reads the revisions tab", () => {
    const raw = encodePreference({ expanded: false, tab: "revisions" });
    expect(parseSidebarPreference(raw).tab).toBe("revisions");
  });

  it("keeps the open state when the tab is one this build lacks", () => {
    const raw = encodePreference({ expanded: true, tab: "history" });
    expect(parseSidebarPreference(raw)).toEqual({
      expanded: true,
      tab: "this-pr",
    });
  });

  it("falls back to collapsed for a non-boolean expanded", () => {
    const raw = encodePreference({ expanded: "yes", tab: "this-pr" });
    expect(parseSidebarPreference(raw)).toEqual(DEFAULT_SIDEBAR_PREFERENCE);
  });
});

describe("the preference cookie", () => {
  it("reads back what was written", () => {
    writeSidebarPreference({ expanded: true, tab: "revisions" });

    expect(readSidebarPreference()).toEqual({
      expanded: true,
      tab: "revisions",
    });
  });

  it("defaults when the cookie is absent", () => {
    expect(readSidebarPreference()).toEqual(DEFAULT_SIDEBAR_PREFERENCE);
  });
});

describe("the overlay hint", () => {
  it("is unset until a load records the overlay range", () => {
    expect(readSidebarOverlayHint()).toBe(false);

    writeSidebarOverlayHint(true);
    expect(readSidebarOverlayHint()).toBe(true);

    writeSidebarOverlayHint(false);
    expect(readSidebarOverlayHint()).toBe(false);
  });

  it("writes only when the range changed", () => {
    writeSidebarOverlayHint(true);
    const writes = vi.spyOn(document, "cookie", "set");

    writeSidebarOverlayHint(true);

    expect(writes).not.toHaveBeenCalled();
  });
});

describe("resolveShownPreference", () => {
  const open = { expanded: true, tab: "revisions" } as const;

  it("shows the stored preference where the panel pushes the story", () => {
    expect(resolveShownPreference(open, false)).toEqual(open);
  });

  it("keeps an open panel closed where it would overlay the story", () => {
    expect(resolveShownPreference(open, true)).toEqual({
      expanded: false,
      tab: "revisions",
    });
  });
});

describe("migrateLegacySidebarPreference", () => {
  it("moves a preference stored before the cookie into it, once", () => {
    window.localStorage.setItem(
      LEGACY_SIDEBAR_STORAGE_KEY,
      JSON.stringify({ expanded: true, tab: "revisions" }),
    );

    expect(migrateLegacySidebarPreference()).toEqual({
      expanded: true,
      tab: "revisions",
    });
    expect(readSidebarPreference()).toEqual({
      expanded: true,
      tab: "revisions",
    });
    expect(window.localStorage.getItem(LEGACY_SIDEBAR_STORAGE_KEY)).toBeNull();
    expect(migrateLegacySidebarPreference()).toBeUndefined();
  });

  it("leaves a cookie already set alone", () => {
    writeSidebarPreference({ expanded: false, tab: "this-pr" });
    window.localStorage.setItem(
      LEGACY_SIDEBAR_STORAGE_KEY,
      JSON.stringify({ expanded: true, tab: "revisions" }),
    );

    expect(migrateLegacySidebarPreference()).toBeUndefined();
    expect(readCookieValue(document.cookie, SIDEBAR_COOKIE)).toBe(
      encodePreference({ expanded: false, tab: "this-pr" }),
    );
  });

  it("migrates nothing when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(migrateLegacySidebarPreference()).toBeUndefined();
  });
});
