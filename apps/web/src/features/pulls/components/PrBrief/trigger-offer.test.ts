import { describe, expect, it } from "vitest";

import { readOffersTrigger, type TriggerOfferInput } from "./trigger-offer";

describe("readOffersTrigger", () => {
  const offered: TriggerOfferInput = {
    prState: "open",
    viewerCanPush: true,
    appInstalled: true,
  };

  it("offers a pusher on an open, installed pull request", () => {
    expect(readOffersTrigger(offered)).toBe(true);
  });

  it.each([
    ["a viewer without push access", { viewerCanPush: false }],
    ["a repository with no App installation", { appInstalled: false }],
    ["a merged pull request", { prState: "merged" }],
    ["a state this bundle does not know", { prState: "unknown" }],
  ] as const)("withholds it from %s", (_label, overrides) => {
    expect(readOffersTrigger({ ...offered, ...overrides })).toBe(false);
  });
});
