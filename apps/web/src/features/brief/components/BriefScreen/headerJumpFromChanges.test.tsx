// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../i18n/I18nProvider";
import { renderInRouter } from "../../../../test/router";
import type { BriefSearchParams } from "../../comparison/compareState";
import type { ComparisonMarks, RevisionNarrative } from "../../types";
import { briefFixture } from "@web/features/brief/fixtures";
import { BriefView } from "../BriefView";

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
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    await renderInRouter(
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <BriefView
            artifacts={[]}
            brief={briefWithRemainder}
            briefId="fixture-brief-2"
            comparisonPlan={{
              lastReview: {
                marks: {
                  queryKey: ["test-last-review-marks"],
                  queryFn: () => Promise.resolve(lastReviewMarks),
                },
              },
            }}
            exitChangesScope={exitChangesScope}
            link="chunk-b"
            searchParams={{ view: "changes", compare: "last-review" }}
          />
        </QueryClientProvider>
      </I18nProvider>,
    );

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

describe("Flag jump from Changes scope", () => {
  it("exits to Full and lands on the flagged chunk", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    function Harness() {
      const [search, setSearch] = useState<BriefSearchParams>({
        view: "changes",
        compare: "previous-brief",
      });
      const [queryClient] = useState(
        () =>
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          }),
      );
      return (
        <I18nProvider>
          <QueryClientProvider client={queryClient}>
            <BriefView
              artifacts={[]}
              brief={briefFixture}
              briefId="fixture-brief-1"
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
          </QueryClientProvider>
        </I18nProvider>
      );
    }

    await renderInRouter(<Harness />);
    const fileButton = await screen.findByRole("button", {
      name: "src/leak.ts",
    });

    fireEvent.click(fileButton);

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
      const [queryClient] = useState(
        () =>
          new QueryClient({
            defaultOptions: { queries: { retry: false } },
          }),
      );
      return (
        <I18nProvider>
          <QueryClientProvider client={queryClient}>
            <BriefView
              artifacts={[]}
              brief={briefWithRemainder}
              briefId="fixture-brief-1"
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
          </QueryClientProvider>
        </I18nProvider>
      );
    }

    await renderInRouter(<Harness />);
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
