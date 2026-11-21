import { describe, expect, it } from "vitest";

import { appI18n } from "../../../../../../i18n/I18nProvider";
import { makeAnyGroup, UnmetFixtures } from "@web/test/unmet-conditions";
import type { InboxGeneration } from "../../../../types";
import { readHeldReason } from "./utils";

const t = appI18n.t;
const AT = "2026-09-20T10:00:00Z";
const {
  BOT_NOT_APPROVED,
  BOT_RUNNING,
  CI_FAILED,
  CI_RUNNING,
  LABELS,
  READY_FOR_REVIEW,
  SIZE_OVER,
} = UnmetFixtures;

function makeHeld(
  unmetConditions: NonNullable<InboxGeneration["unmetConditions"]>,
): InboxGeneration {
  return { status: "held", updatedAt: AT, unmetConditions };
}

describe("readHeldReason", () => {
  it("leads with what needs a change, then counts the rest", () => {
    const held = makeHeld([CI_RUNNING, LABELS, BOT_RUNNING]);

    expect(readHeldReason(t, held, "open")).toEqual({
      text: "Needs the label needs-brief",
      more: 2,
    });
  });

  it("reads the first wait when nothing needs a change", () => {
    expect(readHeldReason(t, makeHeld([BOT_RUNNING]), "open")).toEqual({
      text: "Waiting for CodeRabbit to finish",
      more: 0,
    });
  });

  it("names an any group by how many conditions it offers", () => {
    const group = makeAnyGroup(BOT_NOT_APPROVED, SIZE_OVER);

    expect(readHeldReason(t, makeHeld([group]), "open")).toEqual({
      text: "Needs one of 2 conditions",
      more: 0,
    });
  });

  it("reads an any group left with one member as that member", () => {
    const group = makeAnyGroup(SIZE_OVER);

    expect(readHeldReason(t, makeHeld([group]), "open")?.text).toBe(
      "1284 changed lines, over the 800 maximum",
    );
  });

  it("puts a plain blocker ahead of an any group", () => {
    const group = makeAnyGroup(BOT_NOT_APPROVED, SIZE_OVER);
    const held = makeHeld([READY_FOR_REVIEW, CI_RUNNING, group]);

    expect(readHeldReason(t, held, "open")).toEqual({
      text: "Needs this pull request marked ready for review",
      more: 2,
    });
  });

  it("gives failed CI its first line, the failed checks", () => {
    expect(readHeldReason(t, makeHeld([CI_FAILED]), "open")?.text).toBe(
      "CI failed: test",
    );
  });

  it("gives nothing for a head that is not held, or no reason at all", () => {
    expect(
      readHeldReason(t, { status: "failed", updatedAt: AT }, "open"),
    ).toBeUndefined();
    expect(readHeldReason(t, makeHeld([]), "open")).toBeUndefined();
    expect(readHeldReason(t, undefined, "open")).toBeUndefined();
  });

  it("gives nothing for a closed pull request's held head", () => {
    expect(readHeldReason(t, makeHeld([LABELS]), "closed")).toBeUndefined();
  });
});
