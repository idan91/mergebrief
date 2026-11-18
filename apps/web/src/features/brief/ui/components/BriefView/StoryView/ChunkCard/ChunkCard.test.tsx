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
import { act, Profiler, useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { intersectionObservers } from "@web/test/setup";
import { placeStickyTarget, stubStickyRule } from "@web/test/sticky";

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
import { TokenPlanProvider } from "@web/hooks/useTokenPlan";
import type { BriefChunkSize } from "@web/utils/diffTokens/types";
import type * as DiffTableModule from "../../DiffTable";
import type { DiffTableProps } from "../../DiffTable/types";

const bodyFault = vi.hoisted(() => ({ thrown: false }));

vi.mock("../../DiffTable", async (importOriginal) => {
  const actual = await importOriginal<typeof DiffTableModule>();
  function FaultyDiffTable(props: DiffTableProps) {
    if (bodyFault.thrown) {
      throw new Error("diff failed");
    }
    return <actual.DiffTable {...props} />;
  }
  return { ...actual, DiffTable: FaultyDiffTable };
});

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

type HarnessProps = Omit<
  ChunkCardProps,
  "actionsOpen" | "openActions" | "closeActions"
>;

/** Holds the actions sheet's open state the way the Brief's store does. */
function Harness(props: HarnessProps) {
  const [actionsFor, setActionsFor] = useState<string | undefined>(undefined);
  return (
    <ChunkCard
      {...props}
      actionsOpen={actionsFor === props.chunk.id}
      openActions={setActionsFor}
      closeActions={() => setActionsFor(undefined)}
    />
  );
}

interface CardStores {
  queryClient: QueryClient;
  flowStore: ReturnType<typeof createReviewFlowStore>;
  expansionStore: ReturnType<typeof createExpansionStore>;
  positionStore: ReturnType<typeof createReadingPositionStore>;
}

function makeCardStores(
  positionStore = createReadingPositionStore(),
): CardStores {
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
  return {
    queryClient: new QueryClient(),
    flowStore,
    expansionStore: createExpansionStore(),
    positionStore,
  };
}

interface CardProvidersProps {
  stores: CardStores;
  children: ReactNode;
}

function CardProviders({ stores, children }: CardProvidersProps) {
  return (
    <QueryClientProvider client={stores.queryClient}>
      <ReviewSessionProvider
        briefId="test-brief"
        model={buildBriefViewModel(brief)}
      >
        <ReviewFlowProvider store={stores.flowStore}>
          <ExpansionProvider store={stores.expansionStore}>
            <ReviewPostureProvider posture={makeReviewPosture()}>
              <ReadingPositionProvider store={stores.positionStore}>
                {children}
              </ReadingPositionProvider>
            </ReviewPostureProvider>
          </ExpansionProvider>
        </ReviewFlowProvider>
      </ReviewSessionProvider>
    </QueryClientProvider>
  );
}

function makeHarnessProps(overrides: Partial<HarnessProps>): HarnessProps {
  return {
    chunk,
    comparison,
    open: false,
    addressedReviewComments: [],
    toggleChunk: vi.fn(),
    markReviewed: vi.fn(),
    ...overrides,
  };
}

function renderCard(
  overrides: Partial<HarnessProps> = {},
  positionStore = createReadingPositionStore(),
) {
  const toggleChunk = vi.fn();
  const props = makeHarnessProps({ toggleChunk, ...overrides });
  const stores = makeCardStores(positionStore);
  const onCardRender = vi.fn();
  render(
    <CardProviders stores={stores}>
      <Profiler id="card" onRender={onCardRender}>
        <Harness {...props} />
      </Profiler>
    </CardProviders>,
  );
  return { toggleChunk, positionStore, onCardRender };
}

const NO_CHUNK_SIZES: BriefChunkSize[] = [];

/** The same open card under a Brief identity, re-rendered in place under another. */
function renderCardInBrief(briefKey: string) {
  const props = makeHarnessProps({ open: true });
  const stores = makeCardStores();
  const view = render(
    <CardProviders stores={stores}>
      <TokenPlanProvider briefKey={briefKey} chunkSizes={NO_CHUNK_SIZES}>
        <Harness {...props} />
      </TokenPlanProvider>
    </CardProviders>,
  );
  return {
    switchBrief: (nextKey: string) =>
      view.rerender(
        <CardProviders stores={stores}>
          <TokenPlanProvider briefKey={nextKey} chunkSizes={NO_CHUNK_SIZES}>
            <Harness {...props} />
          </TokenPlanProvider>
        </CardProviders>,
      ),
  };
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
    expect(
      within(toggle)
        .getByText("src/[U+202E]txt.exe")
        .closest("[title]")
        ?.getAttribute("title"),
    ).toBe("src/[U+202E]txt.exe");
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

describe("ChunkCard heading", () => {
  it("holds its toggle in a level-three heading named by the file", () => {
    renderCard();

    const heading = screen.getByRole("heading", {
      level: 3,
      name: chunk.file,
    });

    expect(within(heading).getByTestId("chunk-toggle")).toBeTruthy();
  });

  it("names the card after its heading", () => {
    renderCard();

    const card = screen.getByRole("article", { name: chunk.file });

    expect(card.getAttribute("data-testid")).toBe("brief-chunk");
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

  it("takes and loses the mark without rendering again", () => {
    const { positionStore, onCardRender } = renderCard({ open: true });
    const card = screen.getByTestId("brief-chunk");
    const rendersBefore = onCardRender.mock.calls.length;

    act(() => {
      positionStore.getState().actions.setActive(chunk.id, "g1");
    });
    const markedWhileCurrent = card.hasAttribute("data-current");
    act(() => {
      positionStore.getState().actions.setActive("other-chunk", "g1");
    });

    expect(markedWhileCurrent).toBe(true);
    expect(card.hasAttribute("data-current")).toBe(false);
    expect(onCardRender.mock.calls.length).toBe(rendersBefore);
  });

  it("is marked on mount when the reader is already on it", () => {
    const positionStore = createReadingPositionStore();
    positionStore.getState().actions.setActive(chunk.id, "g1");

    renderCard({}, positionStore);

    const card = screen.getByTestId("brief-chunk");
    expect(card.hasAttribute("data-current")).toBe(true);
  });
});

describe("ChunkCard viewed mark", () => {
  afterEach(cleanup);

  it("marks its own chunk from the Viewed label", () => {
    const markReviewed = vi.fn();
    renderCard({ markReviewed });

    fireEvent.click(screen.getByRole("checkbox", { name: /viewed/i }));

    expect(markReviewed).toHaveBeenCalledWith(chunk.id);
  });

  it("names the file in the Viewed mark", () => {
    renderCard();

    expect(
      screen.getByRole("checkbox", {
        name: /^Viewed\s*src\/deeply\/nested\/path\/a\.ts$/,
      }),
    ).toBeTruthy();
  });
});

describe("ChunkCard head facts", () => {
  it("joins the concern and role as text in the head", () => {
    renderCard();
    const role = screen.getByText("Core");

    expect(role.closest("[data-concern]")?.textContent).toBe(
      "Implementation·Core",
    );
    expect(role.closest("[data-color]")).toBeNull();
  });
});

describe("ChunkCard head tools", () => {
  const shareChunk = {
    deriveUrl: (chunkId: string) => `https://brief.test/?l=${chunkId}`,
    commit: vi.fn(),
  };

  it("groups the copy and comment tools in one lane", () => {
    renderCard({ shareChunk });
    const buttons = within(screen.getByTestId("chunk-tools")).getAllByRole(
      "button",
    );
    const names = buttons.map((button) => button.getAttribute("aria-label"));

    expect(names).toEqual([
      "Copy file path",
      "Copy link to this chunk",
      `Add a comment on ${chunk.file}`,
    ]);
  });

  it("marks the comment tool pressed while the file composer is open", () => {
    renderCard({ open: true });
    const comment = within(screen.getByTestId("chunk-tools")).getByRole(
      "button",
      { name: `Add a comment on ${chunk.file}` },
    );
    expect(comment.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(comment);

    expect(comment.getAttribute("aria-pressed")).toBe("true");
  });

  it("marks the copy tool copied after a copy", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
    renderCard();
    const copy = within(screen.getByTestId("chunk-tools")).getByRole("button", {
      name: "Copy file path",
    });

    fireEvent.click(copy);

    await waitFor(() => expect(copy.dataset["state"]).toBe("copied"));
  });
});

describe("ChunkCard chunk actions", () => {
  afterEach(cleanup);

  function openActions() {
    const actions = screen.getByRole("button", { name: "Chunk actions" });
    fireEvent.click(actions);
    return {
      actions,
      dialog: screen.getByRole("dialog", { name: "Chunk actions" }),
    };
  }

  it("opens as a modal dialog with focus on the first row", () => {
    renderCard();
    const { actions, dialog } = openActions();

    expect(dialog.getAttribute("aria-modal")).toBe("true");
    expect(actions.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(
      within(dialog).getByRole("button", { name: "Comment on file" }),
    );
  });

  it("shows the chunk's facts and path inside the sheet", () => {
    renderCard({ chunk: { ...chunk, readAs: "counts-only" } });
    const { dialog } = openActions();

    expect(dialog.textContent).toContain(chunk.file);
    expect(within(dialog).getByText("Implementation")).toBeTruthy();
    expect(within(dialog).getByText("Core")).toBeTruthy();
    expect(within(dialog).getByText("Read as counts only")).toBeTruthy();
  });

  it("keeps the role as its own badge inside the sheet", () => {
    renderCard();
    const { dialog } = openActions();
    const role = within(dialog).getByText("Core");

    expect(role.getAttribute("data-color")).not.toBeNull();
    expect(role.closest("[data-concern]")).toBeNull();
  });

  it("requests the file comment composer from the menu and closes", () => {
    const { toggleChunk } = renderCard({ open: false });
    const { dialog } = openActions();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Comment on file" }),
    );

    expect(toggleChunk).toHaveBeenCalledWith(chunk.id);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("focuses an open file composer from the menu and keeps its text", () => {
    renderCard({ open: true });
    fireEvent.click(
      within(openActions().dialog).getByRole("button", {
        name: "Comment on file",
      }),
    );
    const composer = screen.getByRole("textbox");
    fireEvent.change(composer, { target: { value: "half a thought" } });

    const { dialog } = openActions();
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Comment on file" }),
    );

    const kept = screen.getByRole<HTMLTextAreaElement>("textbox");
    expect(kept.value).toBe("half a thought");
    expect(document.activeElement).toBe(kept);
  });

  it("focuses an open composer when the landscape row asks for it", () => {
    const { positionStore } = renderCard({ open: true });
    fireEvent.click(
      within(openActions().dialog).getByRole("button", {
        name: "Comment on file",
      }),
    );
    const composer = screen.getByRole<HTMLTextAreaElement>("textbox");
    fireEvent.change(composer, { target: { value: "half a thought" } });
    screen.getByRole("button", { name: "Chunk actions" }).focus();

    act(() => {
      positionStore.getState().actions.requestFileComment(chunk.id);
    });

    expect(composer.value).toBe("half a thought");
    expect(document.activeElement).toBe(composer);
  });

  it("returns focus to the actions button on close", () => {
    renderCard();
    const { actions, dialog } = openActions();

    fireEvent.keyDown(dialog, { key: "Escape" });

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(actions);
    expect(actions.getAttribute("aria-expanded")).toBe("false");
  });

  it("copies the chunk link from the sheet row", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const commit = vi.fn();
    renderCard({
      shareChunk: {
        deriveUrl: (chunkId: string) => `https://brief.test/?l=${chunkId}`,
        commit,
      },
    });
    const { dialog } = openActions();

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Copy link to this chunk" }),
    );

    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `https://brief.test/?l=${chunk.id}`,
      ),
    );
    expect(commit).toHaveBeenCalledWith(chunk.id);
    expect(within(dialog).getByText("Copied")).toBeTruthy();
  });

  it("links the file on GitHub at the brief's head", () => {
    renderCard({
      chunk: {
        ...chunk,
        diff: [
          { kind: "hunk", content: "@@ -10,1 +10,2 @@" },
          { kind: "add", content: "validate(a);", newLine: 11 },
        ],
      },
      githubHead: { repoSlug: "acme/widgets", sha: "head1234" },
    });
    const { dialog } = openActions();

    const link = within(dialog).getByRole("link", { name: /open on github/i });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/acme/widgets/blob/head1234/src/deeply/nested/path/a.ts",
    );
  });

  it("omits Open on GitHub without a head to link", () => {
    renderCard();
    const { dialog } = openActions();

    expect(
      within(dialog).queryByRole("link", { name: /open on github/i }),
    ).toBeNull();
  });

  it("omits Open on GitHub for a deleted file", () => {
    renderCard({
      chunk: {
        ...chunk,
        diff: [
          { kind: "hunk", content: "@@ -1,1 +0,0 @@" },
          { kind: "del", content: "validate(a);", oldLine: 1 },
        ],
      },
      githubHead: { repoSlug: "acme/widgets", sha: "head1234" },
    });
    const { dialog } = openActions();

    expect(
      within(dialog).queryByRole("link", { name: /open on github/i }),
    ).toBeNull();
  });

  it("links the file on GitHub before its diff rows land", () => {
    const { diff: _rows, ...rowless } = chunk;
    renderCard({
      chunk: { ...rowless, loc: { added: 2, deleted: 0 } },
      githubHead: { repoSlug: "acme/widgets", sha: "head1234" },
    });
    const { dialog } = openActions();

    const link = within(dialog).getByRole("link", { name: /open on github/i });
    expect(link.getAttribute("href")).toBe(
      "https://github.com/acme/widgets/blob/head1234/src/deeply/nested/path/a.ts",
    );
  });

  it("omits Open on GitHub for a deleted file whose rows never landed", () => {
    const { diff: _rows, ...rowless } = chunk;
    renderCard({
      chunk: {
        ...rowless,
        loc: { added: 0, deleted: 1 },
        addedRanges: [],
        removedRanges: [{ start: 1, end: 1 }],
      },
      githubHead: { repoSlug: "acme/widgets", sha: "head1234" },
    });
    const { dialog } = openActions();

    expect(
      within(dialog).queryByRole("link", { name: /open on github/i }),
    ).toBeNull();
  });
});

describe("ChunkCard stuck head", () => {
  const STICKY_TOP_PX = 100;
  let stickyRule: HTMLStyleElement | undefined;

  function readHead(): HTMLElement {
    const head = screen.getByTestId("brief-chunk").firstElementChild;
    if (!(head instanceof HTMLElement)) {
      throw new Error("the chunk card has no head");
    }
    return head;
  }

  beforeEach(() => {
    stickyRule = stubStickyRule(
      '[data-testid="brief-chunk"] > div:first-child',
      STICKY_TOP_PX,
    );
  });

  afterEach(() => {
    stickyRule?.remove();
    intersectionObservers.length = 0;
  });

  it("marks the head stuck while it is pinned under the stack", () => {
    renderCard();

    placeStickyTarget(readHead(), STICKY_TOP_PX, STICKY_TOP_PX);

    expect(readHead().dataset["stuck"]).toBe("");
  });

  it("leaves a head that rests below the stack unmarked", () => {
    renderCard();

    placeStickyTarget(readHead(), STICKY_TOP_PX, STICKY_TOP_PX + 300);

    expect(readHead().hasAttribute("data-stuck")).toBe(false);
  });

  it("arms the head's motion once its first reading has painted", async () => {
    renderCard();

    placeStickyTarget(readHead(), STICKY_TOP_PX, STICKY_TOP_PX);

    await waitFor(() => expect(readHead().dataset["motion"]).toBe("on"));
  });
});

describe("ChunkCard render failure", () => {
  beforeEach(() => {
    bodyFault.thrown = true;
    // React reports a caught render error on the console; that is the path under test.
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    bodyFault.thrown = false;
    cleanup();
    vi.restoreAllMocks();
  });

  it("keeps the card head when its diff cannot be shown", () => {
    renderCard({ open: true });

    expect(
      screen.getByRole("heading", {
        level: 4,
        name: "This diff could not be shown",
      }),
    ).toBeTruthy();
    expect(screen.getByTestId("chunk-toggle")).toBeTruthy();
  });

  it("shows the diff again when the same chunk opens in another brief", () => {
    const card = renderCardInBrief("brief-1");
    expect(screen.getByRole("alert")).toBeTruthy();
    bodyFault.thrown = false;

    card.switchBrief("brief-2");

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByText("validate(a);")).toBeTruthy();
  });
});
