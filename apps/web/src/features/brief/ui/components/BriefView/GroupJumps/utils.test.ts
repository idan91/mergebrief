import type { TFunction } from "i18next";
import { describe, expect, it } from "vitest";

import { listGroupJumps } from "./utils";

/** Answers with the key and the title it was given, so a test reads which line was picked. */
function stubTranslate(): TFunction {
  return ((key: string, options: { title?: string }) =>
    `${key}|${options.title ?? ""}`) as TFunction;
}

describe("listGroupJumps", () => {
  it("names a jump by the group's title when the brief has one", () => {
    const jumps = listGroupJumps(stubTranslate(), ["g1"], {
      g1: "Restore archived items",
    });

    expect(jumps).toEqual([
      {
        groupId: "g1",
        label: "brief.jumpToGroupTitled|Restore archived items",
      },
    ]);
  });

  it("keeps the plain label for a group without a title", () => {
    const jumps = listGroupJumps(stubTranslate(), ["g1", "g4"], {
      g1: "Restore archived items",
    });

    expect(jumps[1]).toEqual({
      groupId: "g4",
      label: "brief.jumpToGroup|",
    });
  });
});
