// @vitest-environment jsdom
import type { RevisionNarrative } from "brief-core/types";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BriefSearchParams } from "../../comparison/compareState";
import type { ComparisonMarks } from "../../types";
import { briefFixture } from "@web/features/brief/fixtures";
import {
  FixtureBriefView,
  mountBriefHost,
  mountBriefView,
} from "../../test-utils";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const lastReviewMarks: ComparisonMarks = {
  baselineSha: "chk1234",
  headSha: briefFixture.pr.sha,
  baselineLabel: "checkpoint",
  baselineIndex: 1,
  files: [],
};

const briefWithRemainder = {
  ...briefFixture,
  unattributed: [
    {
      file: "src/orphan.ts",
      addedRanges: [{ start: 1, end: 4 }],
      removedRanges: [],
    },
  ],
};

describe("Chunk deep link from Changes scope", () => {
  it("leaves the scope by replacing the arrival entry", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const exitChangesScope = vi.fn();
    await mountBriefView({
      brief: briefWithRemainder,
      briefId: "fixture-brief-2",
      comparisonPlan: {
        lastReview: {
          marks: {
            queryKey: ["test-last-review-marks"],
            queryFn: () => Promise.resolve(lastReviewMarks),
          },
        },
      },
      exitChangesScope,
      link: "chunk-b",
      searchParams: { view: "changes", compare: "last-review" },
    });

    await waitFor(() =>
      expect(exitChangesScope).toHaveBeenCalledWith({ replace: true }),
    );
  });
});

const previousBriefMarks: ComparisonMarks = {
  baselineSha: "prev1234",
  headSha: briefFixture.pr.sha,
  baselineLabel: "previous-brief",
  baselineIndex: 1,
  files: [],
};

/** A narrative chunk over the fixture's flagged chunk, so its section carries the flags. */
const narrative: RevisionNarrative = {
  artifactKind: "revisionNarrative",
  pr: briefFixture.pr,
  prevHeadSha: "prev1234",
  headSha: briefFixture.pr.sha,
  prevIndex: 1,
  headIndex: 2,
  generation: { provider: "anthropic", model: "m", effort: null },
  overview: "This revision tightens the leak check.",
  chunks: [
    {
      id: "rc1",
      briefChangeGroupId: "g1",
      file: "src/leak.ts",
      addedRanges: [{ start: 10, end: 13 }],
      removedRanges: [],
      summary: "Tightens the check.",
    },
  ],
};

function NarrativeHarness() {
  const [search, setSearch] = useState<BriefSearchParams>({
    view: "changes",
    compare: "previous-brief",
  });
  return (
    <FixtureBriefView
      comparisonPlan={{
        previousBrief: {
          marks: {
            queryKey: ["test-previous-marks"],
            queryFn: () => Promise.resolve(previousBriefMarks),
          },
          narrative: {
            queryKey: ["test-narrative"],
            queryFn: () => Promise.resolve(narrative),
          },
        },
      }}
      exitChangesScope={() =>
        setSearch({ view: "full", compare: "previous-brief" })
      }
      searchParams={search}
    />
  );
}

describe("Flag jump from Changes scope", () => {
  it("exits to Full and lands on the flagged chunk", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    await mountBriefHost(<NarrativeHarness />);
    const fileButton = await screen.findByRole("button", {
      name: "src/leak.ts",
    });

    fireEvent.click(fileButton);

    await waitFor(() => expect(document.activeElement?.id).toBe("chunk-a"));
  });
});

describe("Card jump from Changes scope", () => {
  it("exits to Full and lands on the card's owner chunk", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    await mountBriefHost(<NarrativeHarness />);
    const jump = await screen.findByRole("button", {
      name: "Show in Full brief, src/leak.ts",
    });

    fireEvent.click(jump);

    await waitFor(() => expect(document.activeElement?.id).toBe("chunk-a"));
  });
});

describe("Header Jump from Changes scope", () => {
  it("exits to Full and focuses the remainder heading", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    function Harness() {
      const [search, setSearch] = useState<BriefSearchParams>({
        view: "changes",
        compare: "last-review",
      });
      return (
        <FixtureBriefView
          brief={briefWithRemainder}
          comparisonPlan={{
            lastReview: {
              marks: {
                queryKey: ["test-last-review-marks"],
                queryFn: () => Promise.resolve(lastReviewMarks),
              },
            },
          }}
          exitChangesScope={() =>
            setSearch({ view: "full", compare: "last-review" })
          }
          searchParams={search}
        />
      );
    }

    await mountBriefHost(<Harness />);
    await waitFor(() =>
      expect(screen.getByText(briefFixture.pr.title)).toBeTruthy(),
    );
    expect(
      document.getElementById("unattributed-remainder-heading"),
    ).toBeNull();

    fireEvent.click(screen.getByTestId("unattributed-disclosure"));
    fireEvent.click(screen.getByRole("button", { name: "Jump to group" }), {
      detail: 0,
    });

    await waitFor(() =>
      expect(document.activeElement?.id).toBe("unattributed-remainder-heading"),
    );
  });
});
