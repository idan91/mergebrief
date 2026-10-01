// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../i18n/I18nProvider";
import { renderInRouter } from "../../../../test/router";
import type { ComparisonMarks } from "../../types";
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

describe("focus panel scope", () => {
  it("keeps the context panel out of Changes scope", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await renderInRouter(
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <BriefView
            artifacts={[]}
            brief={briefFixture}
            briefId="fixture-brief-scope"
            comparisonPlan={{
              lastReview: {
                marks: {
                  queryKey: ["test-focus-scope-marks"],
                  queryFn: () => Promise.resolve(lastReviewMarks),
                },
              },
            }}
            searchParams={{ view: "changes", compare: "last-review" }}
          />
        </QueryClientProvider>
      </I18nProvider>,
    );

    fireEvent.keyDown(window, { key: "z" });
    await screen.findByTestId("focus-indicator");
    expect(screen.queryByTestId("focus-panel")).toBeNull();
  });
});
