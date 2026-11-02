import type { BetweenHeadsContents } from "brief-core/pr-span";
import { describe, expect, it } from "vitest";
import { LineDiffRequestSchema } from "./schemas";

/** Every field typed required, so a field added to the contents fails here until the schema reads it. */
const FULL_CONTENTS: Required<BetweenHeadsContents> = {
  prevPath: "lib/old.ts",
  path: "lib/new.ts",
  prevContent: "a\n",
  newContent: "b\n",
  modeChange: { prevMode: "100644", newMode: "100755" },
  prevMode: "100644",
  newMode: "100755",
};

describe("LineDiffRequestSchema", () => {
  it("reads back every contents field the parent sends", () => {
    const request = {
      id: 1,
      input: { contents: FULL_CONTENTS, maxEditLength: 9 },
    };

    expect(LineDiffRequestSchema.parse(request)).toEqual(request);
  });

  it.each([
    [
      "the request",
      { id: 1, input: { contents: FULL_CONTENTS, maxEditLength: 9 }, extra: 1 },
    ],
    [
      "the input",
      { id: 1, input: { contents: FULL_CONTENTS, maxEditLength: 9, extra: 1 } },
    ],
    [
      "the contents",
      {
        id: 1,
        input: { contents: { ...FULL_CONTENTS, extra: 1 }, maxEditLength: 9 },
      },
    ],
  ])("refuses a field it does not know on %s", (_level, request) => {
    expect(LineDiffRequestSchema.safeParse(request).success).toBe(false);
  });
});
