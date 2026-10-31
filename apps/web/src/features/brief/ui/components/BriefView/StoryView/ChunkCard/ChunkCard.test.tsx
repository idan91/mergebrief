// @vitest-environment jsdom
import { appI18n } from "../../../../../../../i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReviewFlowStore,
  ReviewSessionProvider,
  ReviewFlowProvider,
} from "@web/features/review/session";
import {
  createExpansionStore,
  ExpansionProvider,
} from "../../../../../model/expansion/useExpansion";
import type { ComparisonOverlayState } from "../../../../../model/comparison/comparison-overlay";
import type { Brief, BriefChunk } from "../../../../../model/types";
import { buildBriefViewModel } from "../../../../../model/utils/view-model";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../../reading/reading-position";
import { ChunkCard, type ChunkCardProps } from ".";
import { ReviewPostureProvider } from "../../../../hooks/useReviewPosture";
import { makeReviewPosture } from "../../../../utils/review-posture";

afterEach(() => {
  window.getSelection()?.removeAllRanges();
});

const chunk: BriefChunk = {
  id: "chunk-a",
  changeGroupId: "g1",
  file: "src/deeply/nested/path/a.ts",
  concern: "implementation",
  role: "core",
  loc: { added: 1, deleted: 0 },
  addedRanges: [{ start: 11, end: 11 }],
  removedRanges: [],
  riskSurface: [],
  diff: [{ kind: "add", content: "validate(a);", newLine: 11 }],
};

const brief: Brief = {
  artifactKind: "brief",
  pr: {
    repo: "acme/widgets",
    number: 7,
    title: "t",
    url: "https://example.com/pr/7",
    sha: "head1234",
    description: "",
  },
  summary: "s",
  changeGroups: [
    {
      id: "g1",
      title: "g",
      summary: "g",
      dominantCategory: "bugfix",
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [chunk],
  concernView: [],
};

const comparison: ComparisonOverlayState = {
  compare: "off",
  marks: null,
  source: { kind: "last-review", delta: null },
  skipReason: null,
  available: false,
  runCount: 0,
};

function renderCard(overrides: Partial<ChunkCardProps> = {}) {
  const toggleChunk = vi.fn();
  const flowStore = createReviewFlowStore(
    {
      saveComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      toggleComment: vi.fn(),
      reanchorComment: vi.fn(),
    },
    appI18n.t,
  );
  const props: ChunkCardProps = {
    chunk,
    comparison,
    open: false,
    addressedReviewComments: [],
    toggleChunk,
    markReviewed: vi.fn(),
    ...overrides,
  };
  const positionStore = createReadingPositionStore();
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSessionProvider
        briefId="test-brief"
        model={buildBriefViewModel(brief)}
      >
        <ReviewFlowProvider store={flowStore}>
          <ExpansionProvider store={createExpansionStore()}>
            <ReviewPostureProvider posture={makeReviewPosture()}>
              <ReadingPositionProvider store={positionStore}>
                <ChunkCard {...props} />
              </ReadingPositionProvider>
            </ReviewPostureProvider>
          </ExpansionProvider>
        </ReviewFlowProvider>
      </ReviewSessionProvider>
    </QueryClientProvider>,
  );
  return { toggleChunk, positionStore };
}

function selectFilePath(toggle: HTMLElement) {
  const file = within(toggle).getByText(chunk.file);
  const range = document.createRange();
  range.selectNodeContents(file);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("ChunkCard file status", () => {
  it("marks a new file with a chip in the header lane", () => {
    renderCard({
      chunk: {
        ...chunk,
        diff: [
          { kind: "hunk", content: "@@ -0,0 +1,1 @@" },
          { kind: "add", content: "validate(a);", newLine: 1 },
        ],
      },
    });

    const chip = screen.getByText("New file");
    expect(chip.getAttribute("data-status")).toBe("new");
    expect(chip.getAttribute("data-color")).toBe("positive");
  });

  it("marks a deleted file", () => {
    renderCard({
      chunk: {
        ...chunk,
        diff: [
          { kind: "hunk", content: "@@ -1,1 +0,0 @@" },
          { kind: "del", content: "validate(a);", oldLine: 1 },
        ],
      },
    });

    expect(screen.getByText("Deleted file").getAttribute("data-color")).toBe(
      "negative",
    );
  });

  it("offers Show diff on a closed large chunk", () => {
    const { toggleChunk } = renderCard({
      chunk: { ...chunk, loc: { added: 2_100, deleted: 40 } },
      open: false,
    });

    expect(screen.getByTestId("large-chunk-notice").textContent).toContain(
      "2,140 changed lines hidden",
    );
    const showDiff = screen.getByRole("button", { name: /^Show diff/ });
    expect(showDiff.textContent).toBe(`Show diff ${chunk.file}`);
    fireEvent.click(showDiff);

    expect(toggleChunk).toHaveBeenCalledWith(chunk.id);
    expect(document.activeElement).toBe(screen.getByTestId("chunk-toggle"));
  });

  it("shows no large-diff notice once the chunk is open", () => {
    renderCard({
      chunk: { ...chunk, loc: { added: 2_100, deleted: 40 } },
      open: true,
    });

    expect(screen.queryByTestId("large-chunk-notice")).toBeNull();
  });

  it("shows no large-diff notice on a closed small chunk", () => {
    renderCard({ open: false });

    expect(screen.queryByTestId("large-chunk-notice")).toBeNull();
  });

  it("marks a file the model read as package changes", () => {
    renderCard({ chunk: { ...chunk, readAs: "package-summary" } });

    expect(screen.getByText("Read as package changes")).toBeTruthy();
  });

  it("marks a file the model read as counts only", () => {
    renderCard({ chunk: { ...chunk, readAs: "counts-only" } });

    expect(screen.getByText("Read as counts only")).toBeTruthy();
  });

  it("marks nothing on an ordinary chunk", () => {
    renderCard();

    expect(screen.queryByText(/New file|Deleted file/)).toBeNull();
  });
});

describe("ChunkCard for a flagged file with no changed lines", () => {
  const carrier: BriefChunk = {
    id: "u-carrier",
    changeGroupId: "unattributed-remainder",
    file: ".npmrc",
    concern: "implementation",
    role: "core",
    loc: { added: 0, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: ["changes-package-source"],
  };

  it("shows the flag and says the file has no changed lines", () => {
    renderCard({ chunk: carrier, open: true });

    expect(screen.getByText("Changes package source")).toBeTruthy();
    expect(screen.getByText("No changed lines to show.")).toBeTruthy();
    expect(screen.queryByText("Diff unavailable")).toBeNull();
    expect(screen.queryByTestId("skeleton-rows")).toBeNull();
  });

  it("keeps the diff-unavailable note on an attributed chunk with no rows", () => {
    renderCard({ chunk: { ...chunk, diff: [] }, open: true });

    expect(screen.getByText("Diff unavailable")).toBeTruthy();
    expect(screen.queryByText(/No changed lines to show/)).toBeNull();
  });
});

describe("ChunkCard selectable file path", () => {
  it("isolates the file path as left-to-right text", () => {
    renderCard({ chunk: { ...chunk, file: ".npmrc" } });

    const toggle = screen.getByTestId("chunk-toggle");
    expect(within(toggle).getByText(".npmrc").closest("bdi")?.dir).toBe("ltr");
  });

  it("shows a bidi override in the path as a visible escape", () => {
    renderCard({ chunk: { ...chunk, file: "src/\u202Etxt.exe" } });

    const toggle = screen.getByTestId("chunk-toggle");
    expect(within(toggle).getByText("src/[U+202E]txt.exe")).toBeTruthy();
    expect(screen.getByRole("button", { name: /copy file path/i }).title).toBe(
      "src/[U+202E]txt.exe",
    );
  });

  it("copies the full file path without toggling the chunk", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const { toggleChunk } = renderCard();
    fireEvent.click(screen.getByRole("button", { name: /copy file path/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(chunk.file));
    expect(toggleChunk).not.toHaveBeenCalled();
    expect(screen.getByText("Copied")).toBeTruthy();
  });

  it("copies the chunk's link from the share callback, chunk untouched", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const commit = vi.fn();
    const shareChunk = {
      deriveUrl: (chunkId: string) =>
        `https://brief.test/repos/1/pulls/2?rev=1&l=${chunkId}`,
      commit,
    };
    const { toggleChunk } = renderCard({ shareChunk });
    fireEvent.click(
      screen.getByRole("button", { name: /copy link to this chunk/i }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `https://brief.test/repos/1/pulls/2?rev=1&l=${chunk.id}`,
      ),
    );
    await waitFor(() => expect(commit).toHaveBeenCalledWith(chunk.id));
    expect(toggleChunk).not.toHaveBeenCalled();
  });

  it("shows no link glyph where nothing can share a chunk", () => {
    renderCard();
    expect(
      screen.queryByRole("button", { name: /copy link to this chunk/i }),
    ).toBeNull();
  });

  it("keeps the chunk closed when the gesture selected the file path", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByTestId("chunk-toggle");
    // Collapsed selection at mousedown, selected by click time. The
    // gesture created the selection.
    fireEvent.mouseDown(toggle);
    selectFilePath(toggle);
    fireEvent.click(toggle, { detail: 1 });
    expect(toggleChunk).not.toHaveBeenCalled();
  });

  it("turns the twist down while open and right while closed", () => {
    renderCard({ open: true });
    const openTwist = screen
      .getByTestId("chunk-toggle")
      .querySelector('[data-icon="caret-down"]');
    expect(openTwist?.hasAttribute("data-rotation")).toBe(false);
    cleanup();

    renderCard({ open: false });
    const closedTwist = screen
      .getByTestId("chunk-toggle")
      .querySelector('[data-icon="caret-down"]');
    expect(closedTwist?.getAttribute("data-rotation")).toBe("270");
  });

  it("toggles on a plain click", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByTestId("chunk-toggle");
    fireEvent.mouseDown(toggle);
    fireEvent.click(toggle, { detail: 1 });
    expect(toggleChunk).toHaveBeenCalledWith(chunk.id);
  });

  it("suppresses a shift-click extension whose focus lands in the button", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByTestId("chunk-toggle");
    // Anchor outside the button (selection started elsewhere), focus
    // extended onto the file path by a shift-click.
    const outside = document.createElement("p");
    outside.textContent = "diff code";
    document.body.append(outside);
    fireEvent.mouseDown(toggle, { detail: 1 });
    const file = within(toggle).getByText(chunk.file);
    const fileText = file.firstChild;
    const outsideText = outside.firstChild;
    if (!(fileText instanceof Text) || !(outsideText instanceof Text)) {
      throw new Error("expected text nodes");
    }
    window.getSelection()?.removeAllRanges();
    window.getSelection()?.setBaseAndExtent(outsideText, 0, fileText, 3);
    fireEvent.click(toggle, { detail: 1 });
    expect(toggleChunk).not.toHaveBeenCalled();
    outside.remove();
  });

  it("toggles on keyboard activation even with a live selection", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByTestId("chunk-toggle");
    selectFilePath(toggle);
    // Keyboard-synthesized clicks carry detail 0 and no prior mousedown.
    fireEvent.click(toggle, { detail: 0 });
    expect(toggleChunk).toHaveBeenCalledWith(chunk.id);
  });

  it("stays suppressed when the gesture re-selects a different range", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByTestId("chunk-toggle");
    // First selection made and suppressed; still live at the next mousedown.
    selectFilePath(toggle);
    fireEvent.mouseDown(toggle);
    // The gesture replaces it with a DIFFERENT range (missed a character).
    const file = within(toggle).getByText(chunk.file);
    const text = file.firstChild;
    if (!(text instanceof Text)) {
      throw new Error("expected a text node");
    }
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 3);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.click(toggle, { detail: 1 });
    expect(toggleChunk).not.toHaveBeenCalled();
  });

  it("nets to zero when a double-click word-selects the file path", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByTestId("chunk-toggle");
    // click(1): collapsed caret. The guard is skipped, toggle fires.
    fireEvent.mouseDown(toggle, { detail: 1 });
    fireEvent.click(toggle, { detail: 1 });
    expect(toggleChunk).toHaveBeenCalledTimes(1);
    // mousedown(2) precedes the browser's word selection.
    fireEvent.mouseDown(toggle, { detail: 2 });
    selectFilePath(toggle);
    // click(2): selection changed during the gesture, so it is suppressed.
    fireEvent.click(toggle, { detail: 2 });
    expect(toggleChunk).toHaveBeenCalledTimes(1);
    // The pair netted one toggle. dblclick undoes it.
    fireEvent.dblClick(toggle);
    expect(toggleChunk).toHaveBeenCalledTimes(2);
  });

  it("leaves a both-toggled pair with a stale chip double-click", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByTestId("chunk-toggle");
    // Firefox/Safari: a stale selection survives mousedowns on
    // unselectable chips. Both clicks pass the snapshot compare.
    selectFilePath(toggle);
    fireEvent.mouseDown(toggle, { detail: 1 });
    fireEvent.click(toggle, { detail: 1 });
    fireEvent.mouseDown(toggle, { detail: 2 });
    fireEvent.click(toggle, { detail: 2 });
    expect(toggleChunk).toHaveBeenCalledTimes(2);
    // Already net zero. No compensation.
    fireEvent.dblClick(toggle);
    expect(toggleChunk).toHaveBeenCalledTimes(2);
  });

  it("never toggles on a jittery double-click that only selected text", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByTestId("chunk-toggle");
    // First press drags across a character. click(1) is suppressed.
    fireEvent.mouseDown(toggle, { detail: 1 });
    selectFilePath(toggle);
    fireEvent.click(toggle, { detail: 1 });
    // Second press word-selects a different range. click(2) is suppressed.
    fireEvent.mouseDown(toggle, { detail: 2 });
    const file = within(toggle).getByText(chunk.file);
    const text = file.firstChild;
    if (!(text instanceof Text)) {
      throw new Error("expected a text node");
    }
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 3);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.click(toggle, { detail: 2 });
    // The pair netted zero. The compensator stays quiet.
    fireEvent.dblClick(toggle);
    expect(toggleChunk).not.toHaveBeenCalled();
  });

  it("toggles on a re-click when a stale selection survives the mousedown", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByTestId("chunk-toggle");
    // Firefox/Safari keep the selection across mousedowns on unselectable
    // content. The selection predates the gesture, so the click counts.
    selectFilePath(toggle);
    fireEvent.mouseDown(toggle);
    fireEvent.click(toggle, { detail: 1 });
    expect(toggleChunk).toHaveBeenCalledWith(chunk.id);
  });
});

describe("ChunkCard reading position", () => {
  it("marks itself current from the position store, not a prop", () => {
    const { positionStore } = renderCard();
    const card = screen.getByTestId("brief-chunk");
    expect(card.getAttribute("data-current")).toBeNull();
    act(() => {
      positionStore.getState().actions.setActive(chunk.id, "g1");
    });
    expect(card.getAttribute("data-current")).toBe("");
    act(() => {
      positionStore.getState().actions.setActive("other-chunk", "g1");
    });
    expect(card.getAttribute("data-current")).toBeNull();
  });
});
