// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_SIDEBAR_PREFERENCE,
  readSidebarPreference,
  SIDEBAR_STORAGE_KEY,
  writeSidebarPreference,
} from "./storage";

afterEach(() => {
  window.localStorage.clear();
});

describe("readSidebarPreference", () => {
  it("defaults to collapsed on This PR when nothing is stored", () => {
    expect(readSidebarPreference()).toEqual(DEFAULT_SIDEBAR_PREFERENCE);
  });

  it("returns the stored preference", () => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ expanded: true, tab: "this-pr" }),
    );
    expect(readSidebarPreference()).toEqual({
      expanded: true,
      tab: "this-pr",
    });
  });

  it("defaults on corrupt JSON", () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, "{not json");
    expect(readSidebarPreference()).toEqual(DEFAULT_SIDEBAR_PREFERENCE);
  });

  it("defaults on a non-object value", () => {
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, JSON.stringify(42));
    expect(readSidebarPreference()).toEqual(DEFAULT_SIDEBAR_PREFERENCE);
  });

  it("reads a stored Revisions tab", () => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ expanded: false, tab: "revisions" }),
    );
    expect(readSidebarPreference().tab).toBe("revisions");
  });

  it("falls back to This PR for an unknown tab and keeps expanded", () => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ expanded: true, tab: "activity" }),
    );
    expect(readSidebarPreference()).toEqual({
      expanded: true,
      tab: "this-pr",
    });
  });

  it("falls back to collapsed for a non-boolean expanded", () => {
    window.localStorage.setItem(
      SIDEBAR_STORAGE_KEY,
      JSON.stringify({ expanded: "yes", tab: "this-pr" }),
    );
    expect(readSidebarPreference()).toEqual(DEFAULT_SIDEBAR_PREFERENCE);
  });

  it("defaults when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readSidebarPreference()).toEqual(DEFAULT_SIDEBAR_PREFERENCE);
  });
});

describe("writeSidebarPreference", () => {
  it("stores the preference under the sidebar key", () => {
    writeSidebarPreference({ expanded: true, tab: "this-pr" });
    expect(window.localStorage.getItem(SIDEBAR_STORAGE_KEY)).toBe(
      JSON.stringify({ expanded: true, tab: "this-pr" }),
    );
  });

  it("swallows a write failure", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() =>
      writeSidebarPreference({ expanded: true, tab: "this-pr" }),
    ).not.toThrow();
  });
});
