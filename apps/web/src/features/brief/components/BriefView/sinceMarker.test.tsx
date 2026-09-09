// @vitest-environment jsdom
// Per-group changed-since marker: when a reviewer checkpoint exists, each
// group header says whether anything in it changed since that checkpoint,
// WITHOUT the Compare lens being active. The delta data was always computed;
// this pins that it is finally visible where people read.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ComparisonMarks, LocalBriefSummary } from "../../types";
import type { BriefComparisonPlan } from "./BriefView";
import { BriefView } from "./BriefView";
import { SinceMarker } from "../BriefScreen/StoryView/GroupCard/SinceMarker/SinceMarker";
import { useComparisonOverlay } from "../BriefScreen/useComparisonOverlay";
import { localComparisonMarksQueryOptions } from "../../queries";
import { briefFixture } from "@web/features/brief/fixtures";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

// briefFixture: one group (g1) with member files src/leak.ts + src/leak.test.ts.
function checkpointMarks(
  files: ComparisonMarks["files"] = [
    {
      file: "src/leak.ts",
      addedRanges: [{ start: 1, end: 2 }],
      removedRanges: [],
    },
  ],
): ComparisonMarks {
  return {
    baselineSha: "chk1234deadbeef00",
    headSha: "head1234",
    baselineLabel: "checkpoint",
    baselineIndex: 1,
    files,
  };
}

function planWith(marks: ComparisonMarks): BriefComparisonPlan {
  return {
    lastReview: {
      marks: {
        queryKey: ["test-last-review-marks"],
        queryFn: () => Promise.resolve(marks),
      },
    },
  };
}

function renderBriefView(comparisonPlan?: BriefComparisonPlan) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <BriefView
        artifacts={[]}
        brief={briefFixture}
        briefId="since-marker-test"
        // Explicit Full Brief + Compare OFF, the state the marker exists
        // for (with a checkpoint the DEFAULT search is the delta lens).
        searchParams={{ view: "full", compare: "off" }}
        {...(comparisonPlan === undefined ? {} : { comparisonPlan })}
      />
    </QueryClientProvider>,
  );
}

describe("per-group changed-since marker", () => {
  it("shows the changed-file count and checkpoint shortsha with Compare OFF", async () => {
    renderBriefView(planWith(checkpointMarks()));
    // src/leak.ts changed, src/leak.test.ts did not → 1 distinct file.
    expect(
      await screen.findByText(/1 file changed since chk1234/i),
    ).toBeTruthy();
  });

  it("says unchanged when no member file moved since the checkpoint", async () => {
    renderBriefView(planWith(checkpointMarks([])));
    expect(
      await screen.findByText(/unchanged since your last review/i),
    ).toBeTruthy();
  });

  it("renders no marker without a checkpoint", () => {
    renderBriefView(undefined);
    expect(screen.queryByText(/changed since/i)).toBeNull();
    expect(screen.queryByText(/unchanged since your last review/i)).toBeNull();
  });

  it("local sidecar path: since-marks resolve with Compare OFF", async () => {
    // Hook-level (a full BriefView with artifacts mounts TimelineNavigator's
    // router Links, which need a RouterProvider): no comparisonPlan → the
    // marks resolve from the artifact's last-review sidecar id even though
    // the active Compare baseline is off.
    const artifact: LocalBriefSummary = {
      id: "since-marker-test",
      artifactKind: "brief",
      repo: briefFixture.pr.repo,
      number: briefFixture.pr.number,
      title: briefFixture.pr.title,
      sha: briefFixture.pr.sha,
      index: 1,
      comparisons: {
        lastReview: {
          marksId: "marks-1",
          baselineSha: "chk1234deadbeef00",
          baselineIndex: 1,
        },
      },
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      localComparisonMarksQueryOptions("marks-1").queryKey,
      checkpointMarks(),
    );
    const { result } = renderHook(
      () =>
        useComparisonOverlay({
          artifacts: [artifact],
          brief: briefFixture,
          briefId: "since-marker-test",
          comparisonPlan: undefined,
          searchParams: { view: "full", compare: "off" },
        }),
      {
        wrapper: ({ children }) => (
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        ),
      },
    );
    await waitFor(() =>
      expect(result.current.sinceReviewMarks?.baselineSha).toBe(
        "chk1234deadbeef00",
      ),
    );
    expect(result.current.activeCompare).toBe("off");
  });

  it("renders plain text, never a button, without a navigation callback", () => {
    // The local demo path passes no openDeltaLens, unlinked by design.
    render(<SinceMarker baselineShortSha="chk1234" changedFileCount={2} />);
    expect(screen.getByText(/2 files changed since chk1234/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
