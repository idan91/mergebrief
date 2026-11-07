// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReviewSessionProvider } from "@web/features/review/session";
import {
  LANDSCAPE_PHONE_QUERY,
  MOBILE_QUERY,
} from "@web/hooks/useMobileViewport";
import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import type { DiffLine } from "@web/utils/diffTokens/types";
import type { FileRowsCache } from "../../../../model/file-rows/cache";
import { FileRowsProvider } from "../../../../model/file-rows/useFileRows";
import type { Brief, BriefChunk } from "../../../../model/types";
import { buildBriefViewModel } from "../../../../model/utils/view-model";
import { renderInRouter } from "../../../../../../test/router";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../reading/reading-position";
import { CONTENT_START_ATTR } from "../utils";
import { LandscapeRow, type LandscapeRowProps } from ".";

function makeChunk(id: string, file: string): BriefChunk {
  return {
    id,
    changeGroupId: "g1",
    file,
    concern: "implementation",
    role: "core",
    loc: { added: 2, deleted: 1 },
    addedRanges: [{ start: 1, end: 2 }],
    removedRanges: [],
    riskSurface: [],
  };
}

const ADDED_ROWS: DiffLine[] = [
  { kind: "hunk", content: "@@ -0,0 +1,1 @@" },
  { kind: "add", content: "a();", newLine: 1 },
];
const DELETED_ROWS: DiffLine[] = [
  { kind: "hunk", content: "@@ -1,1 +0,0 @@" },
  { kind: "del", content: "gone();", oldLine: 1 },
];

const chunkA = makeChunk("c1", "src/alpha.ts");
const chunkB = makeChunk("c2", "src/beta.ts");

const brief: Brief = {
  artifactKind: "brief",
  pr: {
    repo: "acme/widgets",
    number: 7,
    title: "Tighten the cross-param leak",
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
  chunks: [chunkA, chunkB],
  concernView: [],
};

function stubFileRows(rowsByChunk: Record<string, DiffLine[]>): FileRowsCache {
  return {
    attachChunkRows: (chunk: BriefChunk) => ({
      ...chunk,
      diff: rowsByChunk[chunk.id] ?? ADDED_ROWS,
    }),
  } as unknown as FileRowsCache;
}

async function renderRow(
  overrides: Partial<LandscapeRowProps> = {},
  fileRows: FileRowsCache = stubFileRows({}),
) {
  const sentinel = document.createElement("div");
  sentinel.setAttribute(CONTENT_START_ATTR, "");
  // jsdom lays nothing out: the sentinel starts below the stack, as on a page.
  sentinel.getBoundingClientRect = () => new DOMRect(0, 200, 10, 0);
  document.body.append(sentinel);
  const store = createReadingPositionStore();
  const model = buildBriefViewModel(brief);
  const props: LandscapeRowProps = {
    brief,
    model,
    chunkIds: ["c1", "c2"],
    scope: "full",
    openChunks: new Set(["c1"]),
    toggleChunk: vi.fn(),
    markReviewed: vi.fn(),
    marksDisabled: false,
    pending: false,
    jumpToChunk: vi.fn(),
    placeChunkUnderStack: vi.fn(),
    openBriefControls: vi.fn(),
    openSidebarSheet: vi.fn(),
    sidebarSheetOpen: false,
    ...overrides,
  };
  await renderInRouter(
    <ReviewSessionProvider briefId="test-brief" model={model}>
      <FileRowsProvider cache={fileRows}>
        <ReadingPositionProvider store={store}>
          <LandscapeRow {...props} />
        </ReadingPositionProvider>
      </FileRowsProvider>
    </ReviewSessionProvider>,
  );
  const scrollPast = (past: boolean) => {
    sentinel.getBoundingClientRect = () =>
      new DOMRect(0, past ? -10 : 200, 10, 0);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
  };
  const setActive = (chunkId: string) => {
    act(() => {
      store.getState().actions.setActive(chunkId, "g1");
    });
  };
  const row = () => screen.getByTestId("landscape-row");
  return { props, scrollPast, setActive, row, store };
}

describe("LandscapeRow", () => {
  beforeEach(() => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    setMediaQueryMatches(LANDSCAPE_PHONE_QUERY, true);
  });

  afterEach(() => {
    cleanup();
    resetMediaQueries();
    document
      .querySelectorAll(`[${CONTENT_START_ATTR}]`)
      .forEach((node) => node.remove());
  });

  it("names the PR above the first chunk, with no Viewed or menu", async () => {
    const { row, setActive } = await renderRow();
    setActive("c1");

    expect(
      within(row()).getByRole("heading", { level: 1 }).dataset["state"],
    ).toBeUndefined();
    expect(within(row()).queryByRole("checkbox")).toBeNull();
    expect(
      within(row()).queryByRole("button", { name: "Chunk actions" }),
    ).toBeNull();
    expect(within(row()).getByTestId("chunk-indicator").textContent).toContain(
      "Overview",
    );
  });

  it("shows the chunk whose head reached the row, from one id", async () => {
    const { row, scrollPast, setActive } = await renderRow();
    setActive("c1");
    scrollPast(true);

    expect(
      within(row()).getByText("src/alpha.ts", { selector: "bdi" }),
    ).toBeTruthy();
    expect(within(row()).getByText("+2")).toBeTruthy();
    expect(
      within(row()).getByRole("heading", { level: 1 }).dataset["state"],
    ).toBe("hidden");
    expect(within(row()).getByTestId("chunk-indicator").textContent).toContain(
      "Chunk 1 of 2",
    );
  });

  it("marks the chunk the row names at the moment of the tap", async () => {
    const { props, row, scrollPast, setActive } = await renderRow();
    setActive("c1");
    scrollPast(true);

    const viewed = () =>
      within(row()).getByRole("checkbox", { name: /viewed/i });
    expect(viewed().getAttribute("aria-label")).toBeNull();
    fireEvent.click(viewed());
    expect(props.markReviewed).toHaveBeenLastCalledWith("c1");

    setActive("c2");
    expect(
      within(row()).getByText("src/beta.ts", { selector: "bdi" }),
    ).toBeTruthy();
    fireEvent.click(viewed());
    expect(props.markReviewed).toHaveBeenLastCalledWith("c2");
    expect(props.markReviewed).toHaveBeenCalledTimes(2);
  });

  it("folds the same chunk and reads its open state", async () => {
    const { props, row, scrollPast, setActive } = await renderRow();
    setActive("c2");
    scrollPast(true);

    const fold = within(row()).getByRole("button", { name: "src/beta.ts" });
    expect(fold.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(fold);

    expect(props.toggleChunk).toHaveBeenCalledWith("c2");
  });

  it("places a chunk's head under the row when the fold collapses it", async () => {
    const { props, row, scrollPast, setActive } = await renderRow();
    setActive("c1");
    scrollPast(true);

    fireEvent.click(
      within(row()).getByRole("button", { name: "src/alpha.ts" }),
    );

    expect(props.toggleChunk).toHaveBeenCalledWith("c1");
    expect(props.placeChunkUnderStack).toHaveBeenCalledWith("c1");
  });

  it("leaves the page where it is when the fold opens a chunk", async () => {
    const { props, row, scrollPast, setActive } = await renderRow();
    setActive("c2");
    scrollPast(true);

    fireEvent.click(within(row()).getByRole("button", { name: "src/beta.ts" }));

    expect(props.placeChunkUnderStack).not.toHaveBeenCalled();
  });

  it("places an open chunk's head when Viewed collapses it", async () => {
    const { props, row, scrollPast, setActive } = await renderRow();
    setActive("c1");
    scrollPast(true);

    fireEvent.click(within(row()).getByRole("checkbox", { name: /viewed/i }));

    expect(props.markReviewed).toHaveBeenCalledWith("c1");
    expect(props.placeChunkUnderStack).toHaveBeenCalledWith("c1");
  });

  it("orders Previous, the indicator, Next, then Brief controls", async () => {
    const { row, scrollPast, setActive } = await renderRow();
    setActive("c1");
    scrollPast(true);

    const order = [
      within(row()).getByRole("button", { name: "Previous chunk" }),
      within(row()).getByTestId("chunk-indicator"),
      within(row()).getByRole("button", { name: "Next chunk" }),
      within(row()).getByRole("button", { name: "Brief controls" }),
    ];
    const controls = Array.from(
      row().querySelectorAll("button, [data-testid='chunk-indicator']"),
    ).filter((element) => order.includes(element as HTMLElement));

    expect(controls).toEqual(order);
  });

  it("offers no chunk steps in Changes", async () => {
    const { row, scrollPast } = await renderRow({ scope: "changes" });
    scrollPast(true);

    expect(
      within(row()).queryByRole("button", { name: "Next chunk" }),
    ).toBeNull();
  });

  it("opens the chunk menu for the named chunk", async () => {
    const { row, scrollPast, setActive } = await renderRow();
    setActive("c2");
    scrollPast(true);

    fireEvent.click(
      within(row()).getByRole("button", { name: "Chunk actions" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Chunk actions" });
    expect(
      within(dialog).getByText("src/beta.ts", { selector: "bdi" }),
    ).toBeTruthy();
    expect(
      within(dialog)
        .getByRole("link", { name: /open on github/i })
        .getAttribute("href"),
    ).toBe("https://github.com/acme/widgets/blob/head1234/src/beta.ts");
  });

  it("keeps an open chunk menu on its chunk when the reader moves on", async () => {
    const { row, scrollPast, setActive } = await renderRow();
    setActive("c1");
    scrollPast(true);
    fireEvent.click(
      within(row()).getByRole("button", { name: "Chunk actions" }),
    );

    setActive("c2");

    const dialog = screen.getByRole("dialog", { name: "Chunk actions" });
    expect(
      within(dialog)
        .getByRole("link", { name: /open on github/i })
        .getAttribute("href"),
    ).toContain("src/alpha.ts");
  });

  it("names the reader's chunk again once the menu closes", async () => {
    const { row, scrollPast, setActive } = await renderRow();
    setActive("c1");
    scrollPast(true);
    const menuButton = within(row()).getByRole("button", {
      name: "Chunk actions",
    });
    fireEvent.click(menuButton);
    setActive("c2");

    fireEvent.click(
      screen.getByRole("button", { name: "Close chunk actions" }),
    );

    expect(screen.queryByRole("dialog", { name: "Chunk actions" })).toBeNull();
    expect(
      within(row()).getByText("src/beta.ts", { selector: "bdi" }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(menuButton);
  });

  it("hands focus to Brief controls when the menu's chunk has left the row", async () => {
    const { row, scrollPast, setActive } = await renderRow();
    setActive("c1");
    scrollPast(true);
    fireEvent.click(
      within(row()).getByRole("button", { name: "Chunk actions" }),
    );
    scrollPast(false);

    fireEvent.click(
      screen.getByRole("button", { name: "Close chunk actions" }),
    );

    expect(document.activeElement).toBe(
      within(row()).getByRole("button", { name: "Brief controls" }),
    );
  });

  it("holds the chunk's controls inert while a revision loads", async () => {
    const { row, scrollPast, setActive } = await renderRow({ pending: true });
    setActive("c1");
    scrollPast(true);

    const viewed = within(row()).getByRole("checkbox", { hidden: true });
    const controls = within(row()).getByRole("button", {
      name: "Brief controls",
    });
    expect(viewed.closest("[inert]")).not.toBeNull();
    expect(controls.closest("[inert]")).toBeNull();
    expect(row().getAttribute("aria-busy")).toBe("true");
  });

  it("offers no GitHub link for a file the PR deletes", async () => {
    const { row, scrollPast, setActive } = await renderRow(
      {},
      stubFileRows({ c2: DELETED_ROWS }),
    );
    setActive("c2");
    scrollPast(true);

    fireEvent.click(
      within(row()).getByRole("button", { name: "Chunk actions" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Chunk actions" });
    expect(
      within(dialog).queryByRole("link", { name: /open on github/i }),
    ).toBeNull();
  });

  it("links a changed file on GitHub from the chunk menu", async () => {
    const { row, scrollPast, setActive } = await renderRow();
    setActive("c2");
    scrollPast(true);

    fireEvent.click(
      within(row()).getByRole("button", { name: "Chunk actions" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Chunk actions" });
    const link = within(dialog).getByRole("link", { name: /open on github/i });
    expect(link.getAttribute("href")).toContain("src/beta.ts");
  });

  it("offers the GitHub link for added lines before the rows land", async () => {
    const rowless = {
      attachChunkRows: (chunk: BriefChunk) => chunk,
    } as unknown as FileRowsCache;
    const { row, scrollPast, setActive } = await renderRow({}, rowless);
    setActive("c2");
    scrollPast(true);

    fireEvent.click(
      within(row()).getByRole("button", { name: "Chunk actions" }),
    );

    const dialog = screen.getByRole("dialog", { name: "Chunk actions" });
    expect(
      within(dialog).queryByRole("link", { name: /open on github/i }),
    ).not.toBeNull();
  });

  it("asks the named chunk's card for its composer and scrolls to it", async () => {
    const { props, row, scrollPast, setActive, store } = await renderRow();
    setActive("c2");
    scrollPast(true);

    fireEvent.click(
      within(row()).getByRole("button", { name: "Chunk actions" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Comment on file" }));

    expect(props.jumpToChunk).toHaveBeenCalledWith("c2");
    expect(store.getState().fileCommentChunkId).toBe("c2");
  });

  it("names the PR with no Viewed or position while between chunks", async () => {
    const { row, scrollPast, setActive, store } = await renderRow();
    setActive("c1");
    scrollPast(true);

    act(() => {
      store.getState().actions.leaveChunks(false);
    });

    expect(within(row()).queryByRole("checkbox")).toBeNull();
    const indicator = within(row()).getByTestId("chunk-indicator");
    expect(indicator.textContent).toContain("2 chunks");
    expect(indicator.textContent).not.toContain("of 2");
  });

  it.each([
    ["scrolling down past a chunk", "c1", false],
    ["scrolling up past a chunk", "c2", true],
  ])(
    "steps to both sides of a gap left %s",
    async (_direction, lastChunkId, activeBelowReader) => {
      const { props, row, scrollPast, setActive, store } = await renderRow();
      setActive(lastChunkId);
      scrollPast(true);
      act(() => {
        store.getState().actions.leaveChunks(activeBelowReader);
      });

      clickStep(row(), "Previous chunk");
      clickStep(row(), "Next chunk");

      expect(props.jumpToChunk).toHaveBeenNthCalledWith(1, "c1");
      expect(props.jumpToChunk).toHaveBeenNthCalledWith(2, "c2");
    },
  );

  it("steps from the named chunk", async () => {
    const { props, row, scrollPast, setActive } = await renderRow();
    setActive("c1");
    scrollPast(true);

    fireEvent.click(within(row()).getByRole("button", { name: "Next chunk" }));

    expect(props.jumpToChunk).toHaveBeenCalledWith("c2");
  });
});

function clickStep(row: HTMLElement, name: string): void {
  fireEvent.click(within(row).getByRole("button", { name }));
}
