import { describe, expect, it } from "vitest";

import { createI18n } from "i18n";

import { GenerateNotices } from "./consts";
import { readRegenerateNotice } from "./hooks/regenerate-brief/utils";
import { RegenerateResultKinds } from "./types";

const { t } = createI18n();

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
