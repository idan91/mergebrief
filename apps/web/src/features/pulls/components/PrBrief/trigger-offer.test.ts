import { describe, expect, it } from "vitest";

import { createI18n } from "i18n";

import { readRegenerateNotice } from "../../hooks/regenerate-brief/utils";
import { RegenerateResultKinds } from "../../types";
import {
  GenerateNotices,
  readOffersTrigger,
  type TriggerOfferInput,
} from "./trigger-offer";

const { t } = createI18n();

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

describe("GenerateNotices", () => {
  it("reads the card's own copy where the action differs", () => {
    expect(
      readRegenerateNotice(t, RegenerateResultKinds.UPSTREAM, GenerateNotices),
    ).toBe("MergeBrief could not start the brief. Try again in a moment.");
    expect(
      readRegenerateNotice(
        t,
        RegenerateResultKinds.NOT_REGENERABLE,
        GenerateNotices,
      ),
    ).toBe("This brief no longer waits for a click.");
  });

  it("keeps the shared running copy and stays quiet on queued", () => {
    expect(
      readRegenerateNotice(t, RegenerateResultKinds.RUNNING, GenerateNotices),
    ).toMatch(/already generating/);
    expect(
      readRegenerateNotice(t, RegenerateResultKinds.QUEUED, GenerateNotices),
    ).toBe(undefined);
  });
});
