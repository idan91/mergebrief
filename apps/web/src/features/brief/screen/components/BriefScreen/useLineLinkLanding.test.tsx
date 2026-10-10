// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  renderHook,
  screen,
  waitFor,
} from "@testing-library/react";
import type { TFunction } from "i18next";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type ReactNode, useState } from "react";
import { Button } from "@web/components/Button";
import type { LineLinkTarget } from "@web/features/review/utils";

import { briefFixture } from "@web/features/brief/fixtures";
import type { DiffLine } from "@web/utils/diffTokens/types";
import type { BriefSearchParams } from "../../../model/comparison/compareState";
import type { FileRangeResult } from "../../../queries";
import {
  type ComparisonMarks,
  FileRangeResultKinds,
} from "../../../model/types";
import {
  createFileRowsCache,
  type FileRowsCache,
} from "../../../model/utils/fileRows";
import { AddressEventKinds } from "./address/types";
import { LandHistories } from "./landing/types";
import type { ScopeExitOptions } from "./types";
import { useLineLinkLanding } from "./useLineLinkLanding";
import {
  FixtureBriefView,
  mountBriefHost,
  mountBriefView,
} from "../../../test-utils";

afterEach(cleanup);

const lastReviewMarks: ComparisonMarks = {
  baselineSha: "chk1234",
  headSha: briefFixture.pr.sha,
  baselineLabel: "checkpoint",
  baselineIndex: 1,
  files: [],
};

function stubLastReviewPlan() {
  return {
    lastReview: {
      marks: {
        queryKey: ["test-last-review-marks"],
        queryFn: () => Promise.resolve(lastReviewMarks),
      },
    },
  };
}

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

function stubFileRowsCache(): FileRowsCache {
  return {
    isEmpty: false,
    getFileRows: (path: string) =>
      path === "src/leak.ts" ? stubFileRows() : undefined,
  };
}

async function renderWithLink(link: string, withFileRows = false) {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  const navigateLink = vi.fn();
  const fileRows = withFileRows
    ? stubFileRowsCache()
    : createFileRowsCache(new Map());
  await mountBriefView({
    fileRows,
    link,
    navigateLink,
    searchParams: { view: "full", compare: "off" },
  });
  return navigateLink;
}

describe("line link landing from Changes scope", () => {
  it("leaves the scope by replacing the arrival entry, then lands", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const exitChangesScope = vi.fn();
    await mountBriefView({
      comparisonPlan: stubLastReviewPlan(),
      exitChangesScope,
      link: "chunk-a.R10",
      searchParams: { view: "changes", compare: "last-review" },
    });

    await waitFor(() =>
      expect(exitChangesScope).toHaveBeenCalledWith({ replace: true }),
    );
  });

  it("lands on the card and says so when the read fails", async () => {
    const exits = await renderInChangesScope("chunk-a.R4");

    await waitFor(() => expect(document.activeElement?.id).toBe("chunk-a"));
    await waitFor(() =>
      expect(screen.getByTestId("brief-toast").textContent).toBe(READ_FAILED),
    );
    expect(exits).toEqual([{ replace: true }]);
    expect(document.querySelector("tr[data-selected]")).toBeNull();
  });

  it("leaves the scope for the card when the chunk has no rows", async () => {
    const exits = await renderInChangesScope("chunk-b.R2");

    await waitFor(() => expect(document.activeElement?.id).toBe("chunk-b"));
    await waitFor(() =>
      expect(screen.getByTestId("brief-toast").textContent).toBe(READ_FAILED),
    );
    expect(exits).toEqual([{ replace: true }]);
  });

  it("lands on a shown line after leaving the scope, and selects it", async () => {
    const exits = await renderInChangesScope("chunk-a.R10");

    const row = await waitFor(() => {
      const found = document.querySelector('td[data-line-new="10"]');
      const tr = found?.closest("tr");
      if (!(tr instanceof HTMLElement) || tr.closest("[hidden]") !== null) {
        throw new Error("no visible row yet");
      }
      return tr;
    });
    await waitFor(() => expect(document.activeElement).toBe(row));
    expect(row.hasAttribute("data-selected")).toBe(true);
    expect(exits).toEqual([{ replace: true }]);
  });

  it("reads a folded line, leaves the scope once and selects it", async () => {
    const exits = await renderInChangesScope("chunk-a.R4", stubFileRowsCache());

    const row = await waitFor(() => {
      const found = document.querySelector('td[data-line-new="4"]');
      const tr = found?.closest("tr");
      if (!(tr instanceof HTMLElement) || tr.closest("[hidden]") !== null) {
        throw new Error("no visible row yet");
      }
      return tr;
    });
    await waitFor(() => expect(row.hasAttribute("data-selected")).toBe(true));
    expect(exits).toEqual([{ replace: true }]);
    expect(screen.getByTestId("brief-toast").textContent).toBe("");
  });
});

describe("useLineLinkLanding", () => {
  const folded: LineLinkTarget = {
    chunkId: "chunk-a",
    side: "new",
    startLine: 4,
    endLine: 4,
  };

  it("lands a failed read on the card by replace", async () => {
    const { input, provideQueryClient, settleRead } = stubLineLinkInput();
    const { result } = renderHook(() => useLineLinkLanding(input), {
      wrapper: provideQueryClient,
    });

    act(() => {
      result.current.landLine(folded);
    });
    await act(async () => {
      settleRead({ kind: FileRangeResultKinds.UNAVAILABLE });
      await Promise.resolve();
    });

    expect(input.jumpToChunkFromConversation).toHaveBeenCalledWith(
      "chunk-a",
      undefined,
      "instant",
      LandHistories.REPLACE,
    );
    expect(input.announce).toHaveBeenCalledWith("brief.lineLink.readFailed");
  });

  it("acts on nothing when the read settles after a brief switch", async () => {
    const { input, provideQueryClient, settleRead } = stubLineLinkInput();
    const { result, rerender } = renderHook(
      ({ briefId }) => useLineLinkLanding({ ...input, briefId }),
      { initialProps: { briefId: "brief-a" }, wrapper: provideQueryClient },
    );

    act(() => {
      result.current.landLine(folded);
    });
    rerender({ briefId: "brief-b" });
    await act(async () => {
      settleRead({ kind: FileRangeResultKinds.UNAVAILABLE });
      await Promise.resolve();
    });

    expect(input.jumpToChunkFromConversation).not.toHaveBeenCalled();
    expect(input.announce).not.toHaveBeenCalled();
    expect(input.selectLines).not.toHaveBeenCalled();
  });

  it("leaves the URL alone when a short read settles after unmount", async () => {
    const { input, provideQueryClient, settleRead } = stubLineLinkInput();
    const { result, unmount } = renderHook(() => useLineLinkLanding(input), {
      wrapper: provideQueryClient,
    });

    act(() => {
      result.current.landLine(folded);
    });
    unmount();
    await act(async () => {
      settleRead({
        kind: FileRangeResultKinds.READY,
        range: {
          path: "src/leak.ts",
          ref: "a".repeat(40),
          from: 4,
          to: 5,
          lines: ["line 4", "line 5"],
          totalLines: 5,
        },
      });
      await Promise.resolve();
    });

    expect(input.address.send).not.toHaveBeenCalled();
    expect(input.announce).not.toHaveBeenCalled();
  });

  it("lands nothing when a failed read settles after unmount", async () => {
    const { input, provideQueryClient, settleRead } = stubLineLinkInput();
    const { result, unmount } = renderHook(() => useLineLinkLanding(input), {
      wrapper: provideQueryClient,
    });

    act(() => {
      result.current.landLine(folded);
    });
    unmount();
    await act(async () => {
      settleRead({ kind: FileRangeResultKinds.UNAVAILABLE });
      await Promise.resolve();
    });

    expect(input.jumpToChunkFromConversation).not.toHaveBeenCalled();
    expect(input.announce).not.toHaveBeenCalled();
  });

  it("reports a line past the file's end as missing, not selected", async () => {
    const { input, provideQueryClient, settleRead } = stubLineLinkInput();
    const { result } = renderHook(() => useLineLinkLanding(input), {
      wrapper: provideQueryClient,
    });

    act(() => {
      result.current.landLine({ ...folded, startLine: 999, endLine: 999 });
    });
    await act(async () => {
      settleRead({
        kind: FileRangeResultKinds.READY,
        range: {
          path: "src/leak.ts",
          ref: "a".repeat(40),
          from: 14,
          to: 40,
          lines: Array.from({ length: 27 }, () => "line"),
          totalLines: 40,
        },
      });
      await Promise.resolve();
    });

    expect(input.address.send).toHaveBeenCalledWith({
      kind: AddressEventKinds.LINE_LINK_MISSED,
    });
    expect(input.announce).toHaveBeenCalledWith("brief.lineLink.missing");
    expect(result.current.missed).toBe(true);
    expect(input.selectLines).not.toHaveBeenCalled();
    expect(input.expandEdge).not.toHaveBeenCalled();
  });

  it("forgets a miss once the brief switches away and back", () => {
    const { input, provideQueryClient } = stubLineLinkInput();
    const { result, rerender } = renderHook(
      ({ briefId }) => useLineLinkLanding({ ...input, briefId }),
      { initialProps: { briefId: "brief-a" }, wrapper: provideQueryClient },
    );

    act(() => {
      result.current.landLine({ ...folded, chunkId: "nope" });
    });
    expect(result.current.missed).toBe(true);
    rerender({ briefId: "brief-b" });
    expect(result.current.missed).toBe(false);
    rerender({ briefId: "brief-a" });

    expect(result.current.missed).toBe(false);
  });

  it("keeps the chance when the card landing cannot be scheduled", () => {
    const { input, provideQueryClient } = stubLineLinkInput();
    input.jumpToChunkFromConversation.mockReturnValue(false);
    const { result } = renderHook(() => useLineLinkLanding(input), {
      wrapper: provideQueryClient,
    });

    let spent = true;
    act(() => {
      spent = result.current.landLine({ ...folded, chunkId: "chunk-b" });
    });

    expect(spent).toBe(false);
    expect(input.announce).not.toHaveBeenCalled();
  });
});

function stubLineLinkInput() {
  const queryClient = new QueryClient();
  let settleRead: (result: FileRangeResult) => void = () => undefined;
  vi.spyOn(queryClient, "fetchQuery").mockReturnValue(
    new Promise<FileRangeResult>((resolve) => {
      settleRead = resolve;
    }),
  );
  function provideQueryClient({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  }
  const input = {
    briefId: "brief-a",
    chunks: briefFixture.chunks,
    fileRows: createFileRowsCache(new Map()),
    rowsSettled: true,
    expansionSource: { repoId: "repo", prNumber: 1, ref: "a".repeat(40) },
    jumpToChunkFromConversation: vi.fn(() => true),
    selectLines: vi.fn(),
    expandEdge: vi.fn(),
    announce: vi.fn(),
    announceQuietly: vi.fn(),
    address: { send: vi.fn() },
    t: ((key: string) => key) as unknown as TFunction,
  };
  return {
    input,
    provideQueryClient,
    settleRead: (result: FileRangeResult) => settleRead(result),
  };
}

const READ_FAILED =
  "The lines this link names could not be loaded; the chunk is shown instead.";

/** Arrives on the link in Changes scope; the exit flips the scope to Full. */
async function renderInChangesScope(
  link: string,
  fileRows: FileRowsCache = createFileRowsCache(new Map()),
): Promise<(ScopeExitOptions | undefined)[]> {
  vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
  const exits: (ScopeExitOptions | undefined)[] = [];
  function Harness() {
    const [search, setSearch] = useState<BriefSearchParams>({
      view: "changes",
      compare: "last-review",
    });
    return (
      <FixtureBriefView
        comparisonPlan={stubLastReviewPlan()}
        exitChangesScope={(options) => {
          exits.push(options);
          setSearch({ view: "full", compare: "last-review" });
        }}
        fileRows={fileRows}
        link={link}
        navigateLink={vi.fn()}
        searchParams={search}
      />
    );
  }
  await mountBriefHost(<Harness />);

  return exits;
}

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
    function Host() {
      const [brief, setBrief] = useState(briefFixture);
      return (
        <>
          <Button onClick={() => setBrief({ ...briefFixture })}>
            swap brief
          </Button>
          <FixtureBriefView
            brief={brief}
            link="nope.R1"
            navigateLink={vi.fn()}
            searchParams={{ view: "full", compare: "off" }}
          />
        </>
      );
    }
    await mountBriefHost(<Host />);
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
