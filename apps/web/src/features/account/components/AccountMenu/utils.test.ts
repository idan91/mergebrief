// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { openReleaseNotes } from "./utils";

describe("openReleaseNotes", () => {
  it("opens nothing without a URL", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    openReleaseNotes(undefined);

    expect(open).not.toHaveBeenCalled();
  });
});
