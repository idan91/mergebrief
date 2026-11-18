// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { openOnGithub } from "./utils";

describe("openOnGithub", () => {
  it("opens the pull request in a new tab without an opener", () => {
    const open = vi.spyOn(window, "open").mockReturnValue(null);

    openOnGithub("https://github.com/acme/web/pull/7");

    expect(open).toHaveBeenCalledWith(
      "https://github.com/acme/web/pull/7",
      "_blank",
      "noopener,noreferrer",
    );
  });
});
