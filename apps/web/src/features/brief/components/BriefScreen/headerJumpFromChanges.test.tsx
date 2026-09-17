// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../i18n/I18nProvider";
import type { BriefSearchParams } from "../../comparison/compareState";
import type { ComparisonMarks } from "../../types";
import { briefFixture } from "@web/features/brief/fixtures";
import { BriefView } from "../BriefView/BriefView";

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
    window.location.hash = "#chunk-chunk-b";
    const exitChangesScope = vi.fn();
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    render(
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
            searchParams={{ view: "changes", compare: "last-review" }}
          />
        </QueryClientProvider>
      </I18nProvider>,
    );

    await waitFor(() =>
      expect(exitChangesScope).toHaveBeenCalledWith({ replace: true }),
    );
    window.location.hash = "";
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

    render(<Harness />);
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
