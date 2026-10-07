// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Button } from "@web/components/Button";

import { I18nProvider } from "../../../../i18n/I18nProvider";
import { renderInRouter } from "../../../../test/router";
import { briefFixture } from "@web/features/brief/fixtures";
import type { DiffLine } from "@web/utils/diffTokens/types";
import type { ComparisonMarks } from "../../types";
import { createFileRowsCache } from "../../utils/fileRows";
import { BriefView } from "../BriefView";

afterEach(cleanup);

/** The whole head file as the PR diff would show it, so an edge reads locally. */
function stubFileRows(): DiffLine[] {
  const rows: DiffLine[] = [];
  for (let line = 1; line <= 40; line += 1) {
    if (line === 10) {
      rows.push({ kind: "add", content: "validate(a);", newLine: 10 });
      continue;
    }
    rows.push({
      kind: "ctx",
      content: `line ${String(line)}`,
      oldLine: line < 10 ? line : line - 1,
      newLine: line,
    });
  }
  return rows;
}

async function renderWithLink(link: string, withFileRows = false) {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  const navigateLink = vi.fn();
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const fileRows = withFileRows
    ? {
        isEmpty: false,
        getFileRows: (path: string) =>
          path === "src/leak.ts" ? stubFileRows() : undefined,
      }
    : createFileRowsCache(new Map());
  await renderInRouter(
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <BriefView
          artifacts={[]}
          brief={briefFixture}
          briefId="fixture-brief"
          fileRows={fileRows}
          link={link}
          navigateLink={navigateLink}
          searchParams={{ view: "full", compare: "off" }}
        />
      </QueryClientProvider>
    </I18nProvider>,
  );
  return navigateLink;
}

describe("line link landing from Changes scope", () => {
  it("leaves the scope by replacing the arrival entry, then lands", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const exitChangesScope = vi.fn();
    const lastReviewMarks: ComparisonMarks = {
      baselineSha: "chk1234",
      headSha: briefFixture.pr.sha,
      baselineLabel: "checkpoint",
      baselineIndex: 1,
      files: [],
    };
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await renderInRouter(
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <BriefView
            artifacts={[]}
            brief={briefFixture}
            briefId="fixture-brief"
            comparisonPlan={{
              lastReview: {
                marks: {
                  queryKey: ["test-last-review-marks"],
                  queryFn: () => Promise.resolve(lastReviewMarks),
                },
              },
            }}
            exitChangesScope={exitChangesScope}
            link="chunk-a.R10"
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

describe("line link landing", () => {
  it("lands on a shown line, selects it and keeps the link", async () => {
    const navigateLink = await renderWithLink("chunk-a.R10");

    const row = await waitFor(() => {
      const cell = document.querySelector('td[data-line-new="10"]');
      const found = cell?.closest("tr");
      if (!(found instanceof HTMLElement)) {
        throw new Error("no row yet");
      }
      return found;
    });
    await waitFor(() => expect(row.hasAttribute("data-selected")).toBe(true));
    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(navigateLink).not.toHaveBeenCalledWith(undefined);
    expect(screen.queryByTestId("line-link-notice")).toBeNull();
  });

  it("selects a range and announces it", async () => {
    await renderWithLink("chunk-a.R9-R10");

    await waitFor(() =>
      expect(document.querySelectorAll("tr[data-selected]")).toHaveLength(2),
    );
    await waitFor(() =>
      expect(screen.getByTestId("brief-live").textContent).toBe(
        "Lines 9 to 10 selected.",
      ),
    );
    expect(screen.getByTestId("brief-toast").textContent).toBe("");
  });

  it("expands a folded line from the nearer edge, then lands on it", async () => {
    await renderWithLink("chunk-a.R4", true);

    const row = await waitFor(() => {
      const cell = document.querySelector('td[data-line-new="4"]');
      const found = cell?.closest("tr");
      if (!(found instanceof HTMLElement)) {
        throw new Error("no row yet");
      }
      return found;
    });
    await waitFor(() => expect(row.hasAttribute("data-selected")).toBe(true));
  });

  it("drops the link and shows the notice when it misses", async () => {
    const navigateLink = await renderWithLink("nope.R1");

    await waitFor(() =>
      expect(screen.getByTestId("line-link-notice")).toBeTruthy(),
    );
    expect(navigateLink).toHaveBeenCalledWith(undefined);
    await waitFor(() =>
      expect(screen.getByTestId("brief-toast").textContent).toBe(
        "This link points at lines this brief does not contain.",
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByTestId("line-link-notice")).toBeNull();
  });

  it("shows the chunk and keeps the link when the edge cannot read", async () => {
    // No file rows and no expansion source: the edge cannot read now.
    const navigateLink = await renderWithLink("chunk-a.R4");

    await waitFor(() =>
      expect(screen.getByTestId("brief-toast").textContent).toBe(
        "The lines this link names could not be loaded; the chunk is shown instead.",
      ),
    );
    expect(screen.queryByTestId("line-link-notice")).toBeNull();
    expect(navigateLink).not.toHaveBeenCalledWith(undefined);
    expect(document.querySelector("tr[data-selected]")).toBeNull();
  });

  it("keeps the notice when the brief object changes under the same id", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    function Host() {
      const [brief, setBrief] = useState(briefFixture);
      return (
        <>
          <Button onClick={() => setBrief({ ...briefFixture })}>
            swap brief
          </Button>
          <BriefView
            artifacts={[]}
            brief={brief}
            briefId="fixture-brief"
            link="nope.R1"
            navigateLink={vi.fn()}
            searchParams={{ view: "full", compare: "off" }}
          />
        </>
      );
    }
    await renderInRouter(
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <Host />
        </QueryClientProvider>
      </I18nProvider>,
    );
    await waitFor(() =>
      expect(screen.getByTestId("line-link-notice")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: "swap brief" }));

    expect(screen.getByTestId("line-link-notice")).toBeTruthy();
  });

  it("moves focus to the main landmark when the notice is dismissed", async () => {
    await renderWithLink("nope.R1");
    const dismiss = await waitFor(() =>
      screen.getByRole("button", { name: "Dismiss" }),
    );
    dismiss.focus();
    fireEvent.click(dismiss);

    expect(document.activeElement?.id).toBe("main-content");
  });
});
