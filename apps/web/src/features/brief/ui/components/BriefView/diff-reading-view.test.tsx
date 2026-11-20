// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import { useCallback, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "@web/components/Button";
import { DiffViews, type DiffView } from "@web/components/DiffRows/types";
import { ApiError, ApiErrorCodes } from "@web/data/apiFetch";
import { readCookieValue } from "@web/utils/preference-cookie";
import { DIFF_VIEW_COOKIE } from "./diff-view/consts";
import type { BriefSearchParams } from "../../../model/comparison/compare-state";
import { buildLocalComparisonPlan } from "../../../model/comparison/local-plan";
import type { BriefComparisonPlan } from "../../../model/comparison/types";
import type { Brief, ComparisonMarks } from "../../../model/types";
import { createFileRowsCache } from "../../../model/file-rows/cache";
import type { DiffQueryState } from "../DiffTimeoutNotice/types";
import { useDiffRetryLanding } from "../DiffTimeoutNotice/useDiffRetryLanding";
import { SinceMarker } from "./StoryView/GroupCard/SinceMarker";
import { useComparisonOverlay } from "./comparison/useComparisonOverlay";
import { buildLocalComparisonMarksQueryOptions } from "../../../queries";
import {
  briefFixture,
  FixtureBriefView,
  mountBriefHost,
  mountBriefView,
  type BriefViewOverrides,
} from "@web/features/brief/test-utils";

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

const TIMEOUT = new ApiError(ApiErrorCodes.DIFF_FETCH_TIMEOUT, 504, "/diff");
const UNAVAILABLE = new ApiError(
  ApiErrorCodes.GITHUB_UNAVAILABLE,
  502,
  "/diff",
);

function findMainContent(): HTMLElement | null {
  return document.getElementById("main-content");
}

function stubFrames(): void {
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
    callback(0);
    return 0;
  });
}

/** Carries a Previous Brief comparison, the Changes scope's precondition. */
const PREVIOUS_BRIEF_PLAN = buildLocalComparisonPlan({
  previousBrief: {
    marksId: "marks-a",
    baselineSha: "0".repeat(40),
    baselineIndex: 0,
  },
});

/** brief-a with its Previous Brief comparison available. */
const COMPARABLE_BRIEF: BriefViewOverrides = {
  briefId: "brief-a",
  comparisonPlan: PREVIOUS_BRIEF_PLAN,
};

function readStampedView(): string | null {
  const region = document.getElementById("main-content");
  if (region === null) {
    throw new Error("main-content not rendered");
  }
  return region.getAttribute("data-diff-view");
}

function readGroupViews(): string[] {
  return screen
    .queryAllByTestId("story-group")
    .map((section) => section.getAttribute("data-diff-view") ?? "");
}

function readToast(): string {
  return screen.getByTestId("brief-toast").textContent ?? "";
}

function pressD(): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key: "d", cancelable: true });
  window.dispatchEvent(event);
  return event;
}

function seedStored(view: DiffView): void {
  document.cookie = `${DIFF_VIEW_COOKIE}=${view}; Path=/`;
}

/**
 * The router's part: the link the page writes comes back as the `link`
 * prop, an outside write replaces it, and a brief switch drops it.
 */
function Host({
  navigateLink,
  initialLink,
}: {
  navigateLink: (link: string | undefined) => void;
  initialLink?: string | undefined;
}) {
  const [link, setLink] = useState<string | undefined>(initialLink);
  const [briefId, setBriefId] = useState("fixture-brief");
  const write = useCallback(
    (next: string | undefined) => {
      navigateLink(next);
      setLink(next);
    },
    [navigateLink],
  );
  const switchBrief = () => {
    setBriefId("fixture-brief-2");
    setLink(undefined);
  };
  return (
    <>
      <Button onClick={() => setLink("chunk-a")}>outside write</Button>
      <Button onClick={switchBrief}>switch brief</Button>
      <FixtureBriefView
        briefId={briefId}
        link={link}
        navigateLink={write}
        searchParams={{ view: "full", compare: "off" }}
      />
    </>
  );
}

function findNumberCell(line: string): HTMLElement {
  const cell = document.querySelector(
    `td[data-select-anchor][data-line-new="${line}"]`,
  );
  if (!(cell instanceof HTMLElement)) {
    throw new Error("expected a number cell");
  }
  return cell;
}

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

/** Explicit Full Brief + Compare OFF, the state the marker exists for (with
 * a checkpoint the DEFAULT search is the last-review comparison). */
const FULL_COMPARE_OFF: BriefSearchParams = { view: "full", compare: "off" };

describe("a landed PR diff", () => {
  afterEach(() => {
    cleanup();
  });

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

describe("BriefView on a brief diff GitHub did not render in time", () => {
  let settleRead: ((next: Partial<DiffQueryState>) => void) | undefined;

  /** The brief page's diff read, driven by hand into the real landing hook. */
  function LandingStage() {
    const [query, setQuery] = useState<DiffQueryState>({
      data: undefined,
      error: TIMEOUT,
      isFetching: false,
      errorUpdateCount: 1,
      refetch: () => Promise.resolve(undefined),
    });
    settleRead = (next) => {
      setQuery((current) => ({ ...current, ...next }));
    };
    const landing = useDiffRetryLanding(query, findMainContent);

    return (
      <>
        <FixtureBriefView diffTimeout={landing.retry} />
        <p data-testid="landing-status" role="status">
          {landing.announcement}
        </p>
      </>
    );
  }

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("bands the timeout under the header and retries the read", async () => {
    const retry = vi.fn();
    await mountBriefView({
      diffTimeout: {
        pending: false,
        failureCount: 1,
        retry,
        releaseFocus: vi.fn(),
      },
    });

    const notice = await screen.findByTestId("diff-timeout-notice");
    expect(notice.textContent).toContain("GitHub took too long");
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("shows no band while the diff read has not timed out", async () => {
    await mountBriefView({ repoId: "repo-1" });

    expect(screen.queryByTestId("diff-timeout-notice")).toBeNull();
  });

  it("lands focus on the reading column and says the diff loaded", async () => {
    stubFrames();
    await mountBriefHost(<LandingStage />);
    screen.getByRole("button", { name: "Try again" }).focus();

    act(() => {
      settleRead?.({ data: "diff --git a/x b/x", error: null });
    });

    expect(screen.queryByTestId("diff-timeout-notice")).toBeNull();
    expect(document.activeElement?.id).toBe("main-content");
    expect(screen.getByTestId("landing-status").textContent).toBe(
      "Diff loaded.",
    );
  });

  it("keeps focus on the button through a failed retry", async () => {
    stubFrames();
    await mountBriefHost(<LandingStage />);
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();

    act(() => {
      settleRead?.({ errorUpdateCount: 2 });
    });

    expect(document.activeElement).toBe(button);
    expect(screen.getByTestId("landing-status").textContent).toBe("");
  });

  it("lands focus on the reading column when the retry fails otherwise", async () => {
    stubFrames();
    await mountBriefHost(<LandingStage />);
    screen.getByRole("button", { name: "Try again" }).focus();

    act(() => {
      settleRead?.({ error: UNAVAILABLE, errorUpdateCount: 2 });
    });

    expect(screen.queryByTestId("diff-timeout-notice")).toBeNull();
    expect(document.activeElement?.id).toBe("main-content");
    expect(screen.getByTestId("landing-status").textContent).toBe(
      "The diff did not load.",
    );
  });
});

describe("the diff view preference", () => {
  afterEach(() => {
    cleanup();
    document.cookie = `${DIFF_VIEW_COOKIE}=; Path=/; Max-Age=0`;
  });

  describe("the remembered diff view", () => {
    it("keeps a group with nothing deleted unified under the split view", async () => {
      seedStored(DiffViews.SPLIT);
      await mountBriefView(COMPARABLE_BRIEF);
      expect(readStampedView()).toBe(DiffViews.SPLIT);
      expect(readGroupViews().length).toBeGreaterThan(0);
      expect(new Set(readGroupViews())).toEqual(new Set([DiffViews.UNIFIED]));
    });

    it("splits a two-sided group while its code is still pending", async () => {
      const pendingTwoSided = {
        ...briefFixture,
        chunks: briefFixture.chunks.map((chunk) => {
          const { diff: _diff, ...pending } = chunk;
          return { ...pending, removedRanges: [{ start: 10, end: 10 }] };
        }),
      };
      seedStored(DiffViews.SPLIT);
      await mountBriefView({ ...COMPARABLE_BRIEF, brief: pendingTwoSided });
      expect(readGroupViews()).toContain(DiffViews.SPLIT);
    });

    it("lets the deep link override the stored view", async () => {
      seedStored(DiffViews.SPLIT);
      await mountBriefView({
        ...COMPARABLE_BRIEF,
        searchParams: { diff: DiffViews.UNIFIED },
      });
      expect(readStampedView()).toBe(DiffViews.UNIFIED);
    });
  });

  describe("announcing the diff view", () => {
    it("names the split view in the live region after D", async () => {
      await mountBriefView(COMPARABLE_BRIEF);

      fireEvent(window, new KeyboardEvent("keydown", { key: "d" }));

      expect(readStampedView()).toBe(DiffViews.SPLIT);
      await waitFor(() => expect(readToast()).toBe("Split view"));
    });

    it("names the split view in the live region after a click", async () => {
      await mountBriefView(COMPARABLE_BRIEF);

      fireEvent.click(screen.getByTestId("sidebar-diff-view"));

      expect(readStampedView()).toBe(DiffViews.SPLIT);
      await waitFor(() => expect(readToast()).toBe("Split view"));
    });
  });

  describe("the diff view toggle in the Changes scope", () => {
    const changesScope: BriefSearchParams = {
      view: "changes",
      compare: "previous-brief",
    };

    it("leaves D to the browser and announces nothing", async () => {
      await mountBriefView({ ...COMPARABLE_BRIEF, searchParams: changesScope });

      const event = pressD();

      expect(event.defaultPrevented).toBe(false);
      expect(
        readCookieValue(document.cookie, DIFF_VIEW_COOKIE),
      ).toBeUndefined();
      expect(readToast()).toBe("");
    });
  });
});

describe("line selection link", () => {
  beforeEach(() => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  });

  it("writes the selection to the link param and drops it on Escape", async () => {
    const navigateLink = vi.fn();
    await mountBriefHost(<Host navigateLink={navigateLink} />);
    const cell = await waitFor(() => findNumberCell("10"));
    const row = cell.closest("tr");
    if (row === null) {
      throw new Error("expected a row");
    }

    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(row);
    await waitFor(() =>
      expect(navigateLink).toHaveBeenLastCalledWith("chunk-a.R10"),
    );
    await waitFor(() =>
      expect(screen.getByTestId("brief-live").textContent).toBe(
        "Line 10 selected.",
      ),
    );
    expect(screen.getByTestId("brief-toast").textContent).toBe("");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(navigateLink).toHaveBeenLastCalledWith(undefined),
    );
    expect(navigateLink).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(screen.getByTestId("brief-live").textContent).toBe(
        "Line selection cleared.",
      ),
    );
    expect(screen.getByTestId("brief-toast").textContent).toBe("");
  });

  it("the chunk glyph writes the chunk link and stands the selection down", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const navigateLink = vi.fn();
    await mountBriefHost(<Host navigateLink={navigateLink} />);
    const cell = await waitFor(() => findNumberCell("10"));
    const row = cell.closest("tr");
    if (row === null) {
      throw new Error("expected a row");
    }
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(row);
    await waitFor(() =>
      expect(navigateLink).toHaveBeenLastCalledWith("chunk-a.R10"),
    );

    const [glyph] = screen.getAllByRole("button", {
      name: /copy link to this chunk/i,
    });
    if (glyph === undefined) {
      throw new Error("expected a chunk glyph");
    }
    fireEvent.click(glyph);

    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(navigateLink).toHaveBeenLastCalledWith("chunk-a"),
    );
    expect(document.querySelector("tr[data-selected]")).toBeNull();
    expect(navigateLink).toHaveBeenCalledTimes(2);
    await waitFor(() =>
      expect(screen.getByTestId("brief-live").textContent).toBe(
        "Line selection cleared.",
      ),
    );
    expect(screen.getByTestId("brief-toast").textContent).toBe("");
  });

  it("never drops a link an outside write replaced", async () => {
    const navigateLink = vi.fn();
    await mountBriefHost(<Host navigateLink={navigateLink} />);
    const cell = await waitFor(() => findNumberCell("10"));
    const row = cell.closest("tr");
    if (row === null) {
      throw new Error("expected a row");
    }
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(row);
    await waitFor(() =>
      expect(navigateLink).toHaveBeenLastCalledWith("chunk-a.R10"),
    );

    fireEvent.click(screen.getByRole("button", { name: "outside write" }));
    fireEvent.keyDown(window, { key: "Escape" });

    await waitFor(() =>
      expect(document.querySelector("tr[data-selected]")).toBeNull(),
    );
    expect(navigateLink).not.toHaveBeenCalledWith(undefined);
    expect(navigateLink).toHaveBeenCalledTimes(1);
  });

  it("writes the same lines again after a brief switch", async () => {
    const navigateLink = vi.fn();
    await mountBriefHost(<Host navigateLink={navigateLink} />);
    const cell = await waitFor(() => findNumberCell("10"));
    const row = cell.closest("tr");
    if (row === null) {
      throw new Error("expected a row");
    }
    fireEvent.mouseDown(cell);
    fireEvent.mouseUp(row);
    await waitFor(() =>
      expect(navigateLink).toHaveBeenLastCalledWith("chunk-a.R10"),
    );

    fireEvent.click(screen.getByRole("button", { name: "switch brief" }));
    await waitFor(() =>
      expect(document.querySelector("tr[data-selected]")).toBeNull(),
    );
    const again = await waitFor(() => findNumberCell("10"));
    const againRow = again.closest("tr");
    if (againRow === null) {
      throw new Error("expected a row");
    }
    fireEvent.mouseDown(again);
    fireEvent.mouseUp(againRow);

    await waitFor(() => expect(navigateLink).toHaveBeenCalledTimes(2));
    expect(navigateLink).toHaveBeenLastCalledWith("chunk-a.R10");
  });
});

// Per-group changed-since marker: when a reviewer checkpoint exists, each
// group header says whether anything in it changed since that checkpoint,
// WITHOUT a comparison being active. The delta data was always computed;
// this pins that it is finally visible where people read.
describe("per-group changed-since marker", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it("says unchanged when no member file moved since the checkpoint", async () => {
    await mountBriefView({
      comparisonPlan: planWith(checkpointMarks([])),
      searchParams: FULL_COMPARE_OFF,
    });
    expect(
      await screen.findByText(/unchanged since your last review/i),
    ).toBeTruthy();
  });

  it("renders no marker without a checkpoint", async () => {
    await mountBriefView({ searchParams: FULL_COMPARE_OFF });
    expect(screen.queryByText(/changed since/i)).toBeNull();
    expect(screen.queryByText(/unchanged since your last review/i)).toBeNull();
  });

  it("local plan: since-marks resolve with Compare off", async () => {
    // Hook-level: the marks resolve from the last-review sidecar id even
    // though the active Compare baseline is off.
    const comparisonPlan = buildLocalComparisonPlan({
      lastReview: {
        marksId: "marks-1",
        baselineSha: "chk1234deadbeef00",
        baselineIndex: 1,
      },
    });
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    queryClient.setQueryData(
      buildLocalComparisonMarksQueryOptions("marks-1").queryKey,
      checkpointMarks(),
    );
    const { result } = renderHook(
      () =>
        useComparisonOverlay({
          brief: briefFixture,
          comparisonPlan,
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

  it("renders plain text, never a button, without a navigation callback", async () => {
    // The local demo path passes no openComparison, unlinked by design.
    render(<SinceMarker baselineShortSha="chk1234" changedFileCount={2} />);
    expect(screen.getByText(/2 files changed since chk1234/i)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
