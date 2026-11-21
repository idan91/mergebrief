// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import type { InboxItem } from "../../../../types";
import { offersEveryPush, offersGenerate, openOnGithub } from "./utils";

const HELD_ROW: InboxItem = {
  repoId: "424242",
  prNumber: 7,
  state: "open",
  draft: false,
  source: "installation",
  viewerIsAuthor: false,
  viewerCanDelete: false,
  viewerCanPush: true,
  generateEveryPush: false,
  behind: false,
  unreachable: false,
  generation: { status: "held", updatedAt: "2026-09-20T10:00:00Z" },
};

describe("offersGenerate", () => {
  it("offers it on an open installation row held for a pusher", () => {
    expect(offersGenerate(HELD_ROW)).toBe(true);
  });

  it.each([
    ["no push access", { viewerCanPush: false }],
    ["a pasted row", { source: "url" as const }],
    ["a closed pull request", { state: "closed" as const }],
    [
      "an awaiting head",
      {
        generation: {
          status: "awaiting-trigger" as const,
          updatedAt: "2026-09-20",
        },
      },
    ],
  ])("withholds it with %s", (_label, overrides) => {
    expect(offersGenerate({ ...HELD_ROW, ...overrides })).toBe(false);
  });
});

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

describe("offersEveryPush", () => {
  it("offers it on an open installation row to a pusher, held or not", () => {
    expect(offersEveryPush(HELD_ROW)).toBe(true);
    expect(
      offersEveryPush({
        ...HELD_ROW,
        generation: { status: "succeeded", updatedAt: "2026-09-20" },
      }),
    ).toBe(true);
  });

  it.each([
    ["no push access", { viewerCanPush: false }],
    ["a pasted row", { source: "url" as const }],
    ["a closed pull request", { state: "closed" as const }],
  ])("withholds it with %s", (_label, overrides) => {
    expect(offersEveryPush({ ...HELD_ROW, ...overrides })).toBe(false);
  });
});
