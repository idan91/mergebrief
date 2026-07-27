// @vitest-environment jsdom
// The chunk header's file path is selectable (BRIEF-14): copying it must not
// toggle the chunk, while a plain click still does.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MindMapProvider } from "@web/features/review/session";
import type { ComparisonOverlayState } from "../../../../comparison/comparisonOverlay";
import type { Brief, BriefChunk } from "../../../../types";
import { buildBriefViewModel } from "../../../../utils/viewModel";
import { ChunkCard, type ChunkCardProps } from "./ChunkCard";

afterEach(cleanup);
afterEach(() => {
  window.getSelection()?.removeAllRanges();
});

const chunk: BriefChunk = {
  id: "chunk-a",
  changeGroupId: "g1",
  file: "src/deeply/nested/path/a.ts",
  concern: "implementation",
  role: "carrier",
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
  const props: ChunkCardProps = {
    chunk,
    comparison,
    active: false,
    open: false,
    forceCollapsed: false,
    activeCommentAnchor: null,
    addressedReviewComments: [],
    cancelCommentComposer: vi.fn(),
    deleteReviewComment: vi.fn(),
    toggleChunk,
    markReviewed: vi.fn(),
    openCommentComposer: vi.fn(),
    saveReviewComment: vi.fn(),
    toggleReviewComment: vi.fn(),
    updateReviewComment: vi.fn(),
    ...overrides,
  };
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MindMapProvider briefId="test-brief" model={buildBriefViewModel(brief)}>
        <ChunkCard {...props} />
      </MindMapProvider>
    </QueryClientProvider>,
  );
  return { toggleChunk };
}

function selectFilePath(toggle: HTMLElement) {
  const file = within(toggle).getByText(chunk.file);
  const range = document.createRange();
  range.selectNodeContents(file);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

describe("ChunkCard — selectable file path (BRIEF-14)", () => {
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

  it("keeps the chunk closed when the gesture selected the file path", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByRole("button", { name: /src\/deeply/ });
    // Collapsed selection at mousedown, selected by click time — the
    // gesture created the selection.
    fireEvent.mouseDown(toggle);
    selectFilePath(toggle);
    fireEvent.click(toggle, { detail: 1 });
    expect(toggleChunk).not.toHaveBeenCalled();
  });

  it("toggles on a plain click", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByRole("button", { name: /src\/deeply/ });
    fireEvent.mouseDown(toggle);
    fireEvent.click(toggle, { detail: 1 });
    expect(toggleChunk).toHaveBeenCalledWith(chunk.id);
  });

  it("suppresses a shift-click extension whose focus lands in the button", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByRole("button", { name: /src\/deeply/ });
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
    const toggle = screen.getByRole("button", { name: /src\/deeply/ });
    selectFilePath(toggle);
    // Keyboard-synthesized clicks carry detail 0 and no prior mousedown.
    fireEvent.click(toggle, { detail: 0 });
    expect(toggleChunk).toHaveBeenCalledWith(chunk.id);
  });

  it("stays suppressed when the gesture re-selects a different range", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByRole("button", { name: /src\/deeply/ });
    // First selection made and suppressed; still live at the next mousedown.
    selectFilePath(toggle);
    fireEvent.mouseDown(toggle);
    // The gesture replaces it with a DIFFERENT range (missed a character).
    const file = within(toggle).getByText(chunk.file);
    const text = file.firstChild;
    if (!(text instanceof Text)) throw new Error("expected a text node");
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
    const toggle = screen.getByRole("button", { name: /src\/deeply/ });
    // click(1): collapsed caret — the guard is skipped, toggle fires.
    fireEvent.mouseDown(toggle, { detail: 1 });
    fireEvent.click(toggle, { detail: 1 });
    expect(toggleChunk).toHaveBeenCalledTimes(1);
    // mousedown(2) precedes the browser's word selection.
    fireEvent.mouseDown(toggle, { detail: 2 });
    selectFilePath(toggle);
    // click(2): selection changed during the gesture — suppressed.
    fireEvent.click(toggle, { detail: 2 });
    expect(toggleChunk).toHaveBeenCalledTimes(1);
    // The pair netted one toggle — dblclick undoes it.
    fireEvent.dblClick(toggle);
    expect(toggleChunk).toHaveBeenCalledTimes(2);
  });

  it("leaves a both-toggled pair alone (stale selection, chip double-click)", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByRole("button", { name: /src\/deeply/ });
    // Firefox/Safari: a stale selection survives mousedowns on
    // unselectable chips — both clicks pass the snapshot compare.
    selectFilePath(toggle);
    fireEvent.mouseDown(toggle, { detail: 1 });
    fireEvent.click(toggle, { detail: 1 });
    fireEvent.mouseDown(toggle, { detail: 2 });
    fireEvent.click(toggle, { detail: 2 });
    expect(toggleChunk).toHaveBeenCalledTimes(2);
    // Already net zero — no compensation.
    fireEvent.dblClick(toggle);
    expect(toggleChunk).toHaveBeenCalledTimes(2);
  });

  it("never toggles on a jittery double-click that only selected text", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByRole("button", { name: /src\/deeply/ });
    // First press drags across a character — click(1) suppressed.
    fireEvent.mouseDown(toggle, { detail: 1 });
    selectFilePath(toggle);
    fireEvent.click(toggle, { detail: 1 });
    // Second press word-selects a different range — click(2) suppressed.
    fireEvent.mouseDown(toggle, { detail: 2 });
    const file = within(toggle).getByText(chunk.file);
    const text = file.firstChild;
    if (!(text instanceof Text)) throw new Error("expected a text node");
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 3);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.click(toggle, { detail: 2 });
    // The pair netted zero — the compensator stays quiet.
    fireEvent.dblClick(toggle);
    expect(toggleChunk).not.toHaveBeenCalled();
  });

  it("toggles on a re-click when a stale selection survives the mousedown", () => {
    const { toggleChunk } = renderCard();
    const toggle = screen.getByRole("button", { name: /src\/deeply/ });
    // Firefox/Safari keep the selection across mousedowns on unselectable
    // content — the selection predates the gesture, so the click counts.
    selectFilePath(toggle);
    fireEvent.mouseDown(toggle);
    fireEvent.click(toggle, { detail: 1 });
    expect(toggleChunk).toHaveBeenCalledWith(chunk.id);
  });
});
