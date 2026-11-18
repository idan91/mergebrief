import { describe, expect, it } from "vitest";

import { briefFixture, makeChunk } from "../../test-utils/fixtures";
import { countBriefFiles } from "./brief-files";

describe("countBriefFiles", () => {
  it("counts each file once across chunks and the remainder", () => {
    const brief = {
      ...briefFixture,
      chunks: [
        { ...makeChunk(), id: "a", file: "src/a.ts" },
        { ...makeChunk(), id: "b", file: "src/a.ts" },
        { ...makeChunk(), id: "c", file: "src/b.ts" },
      ],
      unattributed: [
        { file: "src/b.ts", addedRanges: [], removedRanges: [] },
        { file: "docs/c.md", addedRanges: [], removedRanges: [] },
      ],
    };

    expect(countBriefFiles(brief)).toBe(3);
  });
});
