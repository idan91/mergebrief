// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Button } from "@web/components/Button";
import { I18nProvider } from "../../../../i18n/I18nProvider";
import { renderInRouter } from "../../../../test/router";
import type { BriefSearchParams } from "../../comparison/compareState";
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

function Harness() {
  const [search, setSearch] = useState<BriefSearchParams>({
    view: "changes",
    compare: "last-review",
  });
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: false } } }),
  );

  return (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <Button
          onClick={() => setSearch({ view: "full", compare: "last-review" })}
        >
          to full
        </Button>
        <BriefView
          artifacts={[]}
          brief={briefFixture}
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

function viewedBoxes(): HTMLInputElement[] {
  return screen
    .getAllByRole("checkbox", { name: /Viewed/ })
    .filter((box): box is HTMLInputElement => box instanceof HTMLInputElement);
}

describe("V in Changes scope", () => {
  it("marks nothing viewed in Changes and the active chunk in Full", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await renderInRouter(<Harness />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "to full" })).toBeTruthy(),
    );

    fireEvent.keyDown(window, { key: "z" });
    fireEvent.keyDown(window, { key: "v" });
    fireEvent.click(screen.getByRole("button", { name: "to full" }));

    await waitFor(() => expect(viewedBoxes().length).toBeGreaterThan(0));
    expect(viewedBoxes().some((box) => box.checked)).toBe(false);

    fireEvent.keyDown(window, { key: "v" });

    await waitFor(() =>
      expect(viewedBoxes().filter((box) => box.checked)).toHaveLength(1),
    );
  });
});
