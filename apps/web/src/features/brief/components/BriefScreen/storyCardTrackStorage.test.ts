// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  STORY_CARD_TRACK_STORAGE_KEY,
  clearStoryCardTrack,
  readStoryCardTrack,
  writeStoryCardTrack,
} from "./storyCardTrackStorage";

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe("readStoryCardTrack", () => {
  it("reads nothing when nothing is stored", () => {
    expect(readStoryCardTrack()).toBeUndefined();
  });

  it("reads a stored positive integer", () => {
    window.localStorage.setItem(STORY_CARD_TRACK_STORAGE_KEY, "512");
    expect(readStoryCardTrack()).toBe(512);
  });

  it("reads nothing on corrupt JSON", () => {
    window.localStorage.setItem(STORY_CARD_TRACK_STORAGE_KEY, "{not json");
    expect(readStoryCardTrack()).toBeUndefined();
  });

  it("reads nothing on a negative number", () => {
    window.localStorage.setItem(STORY_CARD_TRACK_STORAGE_KEY, "-40");
    expect(readStoryCardTrack()).toBeUndefined();
  });

  it("reads nothing on a fraction", () => {
    window.localStorage.setItem(STORY_CARD_TRACK_STORAGE_KEY, "412.5");
    expect(readStoryCardTrack()).toBeUndefined();
  });

  it("reads nothing on a string", () => {
    window.localStorage.setItem(
      STORY_CARD_TRACK_STORAGE_KEY,
      JSON.stringify("512"),
    );
    expect(readStoryCardTrack()).toBeUndefined();
  });

  it("reads nothing when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readStoryCardTrack()).toBeUndefined();
  });

  it("reads nothing on the server", () => {
    vi.stubGlobal("window", undefined);
    expect(readStoryCardTrack()).toBeUndefined();
  });
});

describe("writeStoryCardTrack", () => {
  it("stores the raw px number", () => {
    writeStoryCardTrack(480);
    expect(window.localStorage.getItem(STORY_CARD_TRACK_STORAGE_KEY)).toBe(
      "480",
    );
  });

  it("round trips through storage", () => {
    writeStoryCardTrack(480);
    expect(readStoryCardTrack()).toBe(480);
  });

  it("writes nothing on the server", () => {
    vi.stubGlobal("window", undefined);
    expect(() => writeStoryCardTrack(480)).not.toThrow();
  });

  it("swallows a write failure", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    expect(() => writeStoryCardTrack(480)).not.toThrow();
  });
});

describe("clearStoryCardTrack", () => {
  it("removes the stored track", () => {
    writeStoryCardTrack(480);
    clearStoryCardTrack();
    expect(window.localStorage.getItem(STORY_CARD_TRACK_STORAGE_KEY)).toBe(
      null,
    );
  });

  it("clears nothing on the server", () => {
    vi.stubGlobal("window", undefined);
    expect(() => clearStoryCardTrack()).not.toThrow();
  });

  it("swallows a removal failure", () => {
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(() => clearStoryCardTrack()).not.toThrow();
  });
});
