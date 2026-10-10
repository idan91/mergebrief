// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiffViews } from "@web/components/DiffRows/types";
import {
  DIFF_VIEW_STORAGE_KEY,
  readDiffView,
  resolveDiffView,
  writeDiffView,
} from "./diffViewStorage";

afterEach(() => {
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("readDiffView", () => {
  it("defaults to unified when nothing is stored", () => {
    expect(readDiffView()).toBe(DiffViews.UNIFIED);
  });

  it("returns the stored view", () => {
    window.localStorage.setItem(
      DIFF_VIEW_STORAGE_KEY,
      JSON.stringify(DiffViews.SPLIT),
    );
    expect(readDiffView()).toBe(DiffViews.SPLIT);
  });

  it("defaults on corrupt JSON", () => {
    window.localStorage.setItem(DIFF_VIEW_STORAGE_KEY, "{not json");
    expect(readDiffView()).toBe(DiffViews.UNIFIED);
  });

  it("defaults on a view this build no longer ships", () => {
    window.localStorage.setItem(
      DIFF_VIEW_STORAGE_KEY,
      JSON.stringify("inline"),
    );
    expect(readDiffView()).toBe(DiffViews.UNIFIED);
  });

  it("defaults when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readDiffView()).toBe(DiffViews.UNIFIED);
  });
});

describe("readDiffView without a window", () => {
  it("defaults to unified on the server", () => {
    vi.stubGlobal("window", undefined);
    expect(readDiffView()).toBe(DiffViews.UNIFIED);
    vi.unstubAllGlobals();
  });
});

describe("writeDiffView", () => {
  it("round trips through storage", () => {
    writeDiffView(DiffViews.SPLIT);
    expect(readDiffView()).toBe(DiffViews.SPLIT);
  });

  it("writes nothing on the server", () => {
    vi.stubGlobal("window", undefined);
    expect(() => writeDiffView(DiffViews.SPLIT)).not.toThrow();
    vi.unstubAllGlobals();
  });

  it("swallows a write failure", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeDiffView(DiffViews.SPLIT)).not.toThrow();
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
