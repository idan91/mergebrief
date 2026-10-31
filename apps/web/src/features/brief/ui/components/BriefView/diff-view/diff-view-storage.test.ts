// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiffViews } from "@web/components/DiffRows/types";
import {
  buildDiffViewCookie,
  DIFF_VIEW_COOKIE,
  LEGACY_DIFF_VIEW_STORAGE_KEY,
  migrateLegacyDiffView,
  parseDiffView,
  readCookieValue,
  readDiffView,
  resolveDiffView,
  writeDiffView,
} from "./diff-view-storage";

function clearCookie(): void {
  document.cookie = `${DIFF_VIEW_COOKIE}=; Path=/; Max-Age=0`;
}

afterEach(() => {
  clearCookie();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("parseDiffView", () => {
  it("reads a shipped view", () => {
    expect(parseDiffView(DiffViews.SPLIT)).toBe(DiffViews.SPLIT);
  });

  it("defaults to unified when nothing is stored", () => {
    expect(parseDiffView(undefined)).toBe(DiffViews.UNIFIED);
  });

  it("defaults on a view this build no longer ships", () => {
    expect(parseDiffView("inline")).toBe(DiffViews.UNIFIED);
  });
});

describe("readCookieValue", () => {
  it("finds one cookie among several", () => {
    expect(
      readCookieValue("a=1; mergebrief.diffView=split; b=2", DIFF_VIEW_COOKIE),
    ).toBe("split");
  });

  it("is absent when the cookie is not set", () => {
    expect(readCookieValue("a=1; b=2", DIFF_VIEW_COOKIE)).toBeUndefined();
  });

  it("matches the whole name, not a prefix", () => {
    expect(
      readCookieValue("xmergebrief.diffView=split", DIFF_VIEW_COOKIE),
    ).toBeUndefined();
  });
});

describe("readDiffView", () => {
  it("reads the view from the document's cookie", () => {
    document.cookie = `${DIFF_VIEW_COOKIE}=split; Path=/`;
    expect(readDiffView()).toBe(DiffViews.SPLIT);
  });

  it("defaults on an invalid cookie value", () => {
    document.cookie = `${DIFF_VIEW_COOKIE}=sideways; Path=/`;
    expect(readDiffView()).toBe(DiffViews.UNIFIED);
  });
});

describe("writeDiffView", () => {
  it("round trips through the cookie", () => {
    writeDiffView(DiffViews.SPLIT);
    expect(readDiffView()).toBe(DiffViews.SPLIT);
  });
});

describe("buildDiffViewCookie", () => {
  it("scopes the cookie to the site for a long life, readable by script", () => {
    const cookie = buildDiffViewCookie(DiffViews.SPLIT, false);

    expect(cookie).toBe(
      "mergebrief.diffView=split; Path=/; Max-Age=34560000; SameSite=Lax",
    );
    expect(cookie).not.toMatch(/HttpOnly/i);
  });

  it("marks the cookie secure on an https page", () => {
    expect(buildDiffViewCookie(DiffViews.SPLIT, true)).toMatch(/; Secure$/);
  });
});

describe("migrateLegacyDiffView", () => {
  it("moves a stored view into the cookie and drops the old key", () => {
    window.localStorage.setItem(
      LEGACY_DIFF_VIEW_STORAGE_KEY,
      JSON.stringify(DiffViews.SPLIT),
    );

    expect(migrateLegacyDiffView()).toBe(DiffViews.SPLIT);
    expect(readDiffView()).toBe(DiffViews.SPLIT);
    expect(
      window.localStorage.getItem(LEGACY_DIFF_VIEW_STORAGE_KEY),
    ).toBeNull();
  });

  it("leaves a cookie that is already set alone", () => {
    writeDiffView(DiffViews.UNIFIED);
    window.localStorage.setItem(
      LEGACY_DIFF_VIEW_STORAGE_KEY,
      JSON.stringify(DiffViews.SPLIT),
    );

    expect(migrateLegacyDiffView()).toBeUndefined();
    expect(readDiffView()).toBe(DiffViews.UNIFIED);
  });

  it("does nothing when no view was ever stored", () => {
    expect(migrateLegacyDiffView()).toBeUndefined();
    expect(readCookieValue(document.cookie, DIFF_VIEW_COOKIE)).toBeUndefined();
  });

  it("drops a corrupt legacy value without seeding the cookie", () => {
    window.localStorage.setItem(LEGACY_DIFF_VIEW_STORAGE_KEY, "{not json");

    expect(migrateLegacyDiffView()).toBeUndefined();
    expect(
      window.localStorage.getItem(LEGACY_DIFF_VIEW_STORAGE_KEY),
    ).toBeNull();
  });

  it("survives storage that throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(migrateLegacyDiffView()).toBeUndefined();
  });
});

describe("resolveDiffView", () => {
  it("takes the deep link over the stored preference", () => {
    expect(resolveDiffView(DiffViews.SPLIT, DiffViews.UNIFIED)).toBe(
      DiffViews.SPLIT,
    );
    expect(resolveDiffView(DiffViews.UNIFIED, DiffViews.SPLIT)).toBe(
      DiffViews.UNIFIED,
    );
  });

  it("falls back to the stored preference with no deep link", () => {
    expect(resolveDiffView(undefined, DiffViews.SPLIT)).toBe(DiffViews.SPLIT);
  });
});
