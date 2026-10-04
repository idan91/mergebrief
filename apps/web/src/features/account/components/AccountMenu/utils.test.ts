// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openReleaseNotes } from "./utils";

describe("openReleaseNotes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("opens the URL in a new tab without a referrer", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    openReleaseNotes("https://example.test/releases/v1.6.0");

    expect(open).toHaveBeenCalledWith(
      "https://example.test/releases/v1.6.0",
      "_blank",
      "noreferrer",
    );
  });

  it("opens nothing without a URL", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    openReleaseNotes(undefined);

    expect(open).not.toHaveBeenCalled();
  });
});
