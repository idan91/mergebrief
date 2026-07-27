// @vitest-environment jsdom
// The BRIEF-24 raw span diff toggle (locked decision #7): a switch inside the
// Changes Only pane that swaps the summary for the GitHub-style raw diff of the
// same span, rendered read-only through DiffTable.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReviewFlowStore,
  MindMapProvider,
  ReviewFlowProvider,
} from "@web/features/review/session";
import type { ComparisonQuery } from "../../../../comparison/comparisonQuery";
import { briefFixture } from "../../../../utils/fixtures";
import { buildBriefViewModel } from "../../../../utils/viewModel";
import { RawSpanDiff } from "./RawSpanDiff";

afterEach(cleanup);

const DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -1,2 +1,3 @@",
  " const a = 1;",
  "+validate(a);",
  " export { a };",
].join("\n");

function diffQuery(
  base: string,
  head: string,
  body = DIFF,
): ComparisonQuery<string> {
  return {
    queryKey: ["pr-diff", "424242", 7, base, head],
    queryFn: async (): Promise<string> => body,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  };
}

function renderRaw(query: ComparisonQuery<string>, client?: QueryClient) {
  client ??= new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  // DiffTable reads the session stores even in its read-only stand-down, so
  // the raw span renders under the same providers the screen supplies.
  const flowStore = createReviewFlowStore(
    {
      saveComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      toggleComment: vi.fn(),
    },
    {
      composerDisabledReason: undefined,
      flagsReadOnly: false,
      postingCommentIds: new Set(),
      postBlockedExternally: undefined,
      postComment: undefined,
    },
  );
  return render(
    <QueryClientProvider client={client}>
      <MindMapProvider
        briefId="test-brief"
        model={buildBriefViewModel(briefFixture)}
      >
        <ReviewFlowProvider store={flowStore}>
          <RawSpanDiff query={query}>
            <p>Changes Only summary</p>
          </RawSpanDiff>
        </ReviewFlowProvider>
      </MindMapProvider>
    </QueryClientProvider>,
  );
}

/** The toggle button: its accessible NAME is stable — only aria-pressed flips. */
function toggleButton() {
  return screen.getByRole("button", { name: "Raw diff" });
}

describe("RawSpanDiff toggle", () => {
  it("shows the summary with an off toggle by default", () => {
    renderRaw(diffQuery("prev", "head"));
    // Accessible name + state: a real toggle button, pressed=false initially.
    expect(toggleButton().getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Changes Only summary")).toBeTruthy();
  });

  it("renders the raw diff through DiffTable when toggled on", async () => {
    renderRaw(diffQuery("prev", "head"));
    fireEvent.click(toggleButton());

    // Stable accessible name across presses; state lives in aria-pressed
    // (WAI toggle-button contract — codex round 1).
    expect(toggleButton().getAttribute("aria-pressed")).toBe("true");
    // The summary is swapped out for the raw diff.
    expect(screen.queryByText("Changes Only summary")).toBeNull();
    await waitFor(() => {
      expect(screen.getByText("src/a.ts")).toBeTruthy();
      expect(screen.getByText("validate(a);")).toBeTruthy();
    });
  });

  it("renders the raw diff read-only — rows are aria-disabled, not commentable", async () => {
    const { container } = renderRaw(diffQuery("chk", "head"));
    fireEvent.click(toggleButton());
    await waitFor(() => expect(screen.getByText("validate(a);")).toBeTruthy());
    // Read-only posture: the added row is focusable but disabled, no
    // commentable hook (BRIEF-23 pattern).
    const disabledRow = container.querySelector('tr[aria-disabled="true"]');
    expect(disabledRow).not.toBeNull();
    expect(disabledRow?.getAttribute("tabindex")).toBe("0");
    expect(container.querySelector("[data-commentable]")).toBeNull();
  });

  it("returns to the summary when toggled back off", async () => {
    renderRaw(diffQuery("prev", "head"));
    fireEvent.click(toggleButton());
    await waitFor(() => expect(screen.getByText("src/a.ts")).toBeTruthy());
    fireEvent.click(toggleButton());
    expect(toggleButton().getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByText("Changes Only summary")).toBeTruthy();
    expect(screen.queryByText("src/a.ts")).toBeNull();
  });

  it("names a successful empty diff honestly — a no-change span is not a failure", async () => {
    // Identical base/head content (every edit netted out): the fetch succeeds
    // with an empty body — success-empty must not wear the error copy
    // (codex round 2).
    renderRaw(diffQuery("prev", "head", ""));
    fireEvent.click(toggleButton());
    await waitFor(() =>
      expect(screen.getByText(/No raw changes in this span/)).toBeTruthy(),
    );
    expect(
      screen.queryByText("The raw diff is not viewable right now."),
    ).toBeNull();
  });

  it("keeps the not-viewable copy for a failed fetch", async () => {
    renderRaw({
      queryKey: ["pr-diff", "424242", 7, "prev", "head"],
      queryFn: async (): Promise<string> => {
        throw new Error("diff proxy unavailable");
      },
      retry: false,
    });
    fireEvent.click(toggleButton());
    await waitFor(() =>
      expect(
        screen.getByText("The raw diff is not viewable right now."),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/No raw changes in this span/)).toBeNull();
  });

  it("a guarded descriptor vetoes CACHED data — the guard wins over the cache", async () => {
    // enabled: false only blocks FETCHING; react-query still serves a
    // previously-cached body for the same key. A descriptor guarded as
    // unavailable must not render that stale span (codex round 4).
    const queryKey = ["pr-diff", "424242", 7, "prev", "head"];
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    client.setQueryData(queryKey, DIFF);
    renderRaw(
      {
        queryKey,
        queryFn: async (): Promise<string> => DIFF,
        enabled: false,
        retry: false,
      },
      client,
    );
    fireEvent.click(toggleButton());
    await waitFor(() =>
      expect(
        screen.getByText("The raw diff is not viewable right now."),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("validate(a);")).toBeNull();
    expect(screen.queryByText("src/a.ts")).toBeNull();
  });

  it("never fetches a descriptor that disabled itself — opening degrades honestly", async () => {
    const queryFn = vi.fn(async (): Promise<string> => DIFF);
    renderRaw({
      queryKey: ["pr-diff", "424242", 7, "gone", "head"],
      queryFn,
      enabled: false,
      retry: false,
    });
    fireEvent.click(toggleButton());
    // The toggle gates the descriptor's own `enabled`; it must not force a
    // fetch the descriptor guarded against (codex round 1).
    await waitFor(() =>
      expect(
        screen.getByText("The raw diff is not viewable right now."),
      ).toBeTruthy(),
    );
    expect(queryFn).not.toHaveBeenCalled();
  });
});
