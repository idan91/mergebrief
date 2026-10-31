// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { briefFixture, mountBriefView } from "@web/features/brief/test-utils";
import { createFileRowsCache } from "../../../model/file-rows/cache";
import type { Brief } from "../../../model/types";

const LEAK_PATCH = [
  "diff --git a/src/leak.ts b/src/leak.ts",
  "--- a/src/leak.ts",
  "+++ b/src/leak.ts",
  "@@ -9,2 +9,6 @@",
  " const shared = read();",
  "+guardFromPatch(shared);",
  "+validate(shared);",
  "+audit(shared);",
  "+emit(shared);",
  " return shared;",
].join("\n");

/** The brief as the PR route reads it: no chunk carries rows of its own. */
const STORED_BRIEF: Brief = {
  ...briefFixture,
  chunks: briefFixture.chunks.map(({ diff: _rows, ...chunk }) => chunk),
};

afterEach(() => {
  cleanup();
});

describe("a landed PR diff", () => {
  it("draws a card's rows under the same brief object", async () => {
    const view = await mountBriefView({ brief: STORED_BRIEF });
    expect(document.body.textContent).not.toContain("guardFromPatch(shared);");

    view.rerender({
      brief: STORED_BRIEF,
      fileRows: createFileRowsCache(new Map([["src/leak.ts", LEAK_PATCH]])),
    });

    await waitFor(() =>
      expect(document.body.textContent).toContain("guardFromPatch(shared);"),
    );
    expect(screen.getAllByText("guardFromPatch(shared);").length).toBe(1);
  });
});
