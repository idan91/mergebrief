// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "@web/components/Button";
import type { BriefSearchParams } from "../../comparison/compareState";
import type { ComparisonMarks } from "../../types";
import { briefFixture } from "@web/features/brief/fixtures";
import { createFileRowsCache } from "../../utils/fileRows";
import { FixtureBriefView, mountBriefHost } from "../../test-utils";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const previousBriefMarks: ComparisonMarks = {
  baselineSha: "prev1234",
  headSha: briefFixture.pr.sha,
  baselineLabel: "previous-brief",
  baselineIndex: 1,
  files: [],
};

/** The fixture's flagged chunk owns src/leak.ts lines 10 to 13. */
const LEAK_PATCH = [
  "diff --git a/src/leak.ts b/src/leak.ts",
  "--- a/src/leak.ts",
  "+++ b/src/leak.ts",
  "@@ -9,2 +9,6 @@",
  " const before = 1;",
  "+guard(a);",
  "+guard(b);",
  "+guard(c);",
  "+guard(d);",
  " const after = 2;",
].join("\n");

const FILE_ROWS = createFileRowsCache(new Map([["src/leak.ts", LEAK_PATCH]]));

function Harness() {
  const [search, setSearch] = useState<BriefSearchParams>({
    view: "changes",
    compare: "previous-brief",
  });

  return (
    <>
      <Button
        onClick={() => setSearch({ view: "full", compare: "previous-brief" })}
      >
        to full
      </Button>
      <Button
        onClick={() =>
          setSearch({ view: "changes", compare: "previous-brief" })
        }
      >
        to changes
      </Button>
      <FixtureBriefView
        comparisonPlan={{
          previousBrief: {
            marks: {
              queryKey: ["test-previous-marks"],
              queryFn: () => Promise.resolve(previousBriefMarks),
            },
            rawDiff: {
              queryKey: ["test-raw-diff"],
              queryFn: () => Promise.resolve(LEAK_PATCH),
            },
          },
        }}
        exitChangesScope={() =>
          setSearch({ view: "full", compare: "previous-brief" })
        }
        fileRows={FILE_ROWS}
        searchParams={search}
      />
    </>
  );
}

function findSpanRow(): HTMLElement {
  const row = document.querySelector("details tr[data-commentable]");
  if (!(row instanceof HTMLElement)) {
    throw new Error("expected a commentable span row");
  }
  return row;
}

describe("a composer hosted by the hidden scope pane", () => {
  it("is cancelled on a scope switch, so nothing stays open unseen", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await mountBriefHost(<Harness />);
    fireEvent.click(await screen.findByRole("button", { name: "Raw diff" }));
    await waitFor(() => findSpanRow());

    fireEvent.keyDown(findSpanRow(), { key: "Enter" });
    expect(screen.getByPlaceholderText("Leave a comment")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "to full" }));
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Leave a comment")).toBeNull(),
    );

    fireEvent.click(screen.getByRole("button", { name: "to changes" }));
    await waitFor(() => findSpanRow());
    expect(screen.queryByPlaceholderText("Leave a comment")).toBeNull();
  });
});
