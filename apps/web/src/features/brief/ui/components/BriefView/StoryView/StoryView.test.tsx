// @vitest-environment jsdom
import { appI18n } from "@web/i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReviewFlowStore,
  ReviewFlowProvider,
  ReviewSessionProvider,
} from "@web/features/review/session";
import {
  createExpansionStore,
  ExpansionProvider,
} from "../../../../model/expansion/useExpansion";
import type { ComparisonOverlayState } from "../../../../model/comparison/comparison-overlay";
import type { Brief } from "../../../../model/types";
import { briefFixture } from "@web/features/brief/test-utils";
import { buildLineOwnersByFile } from "../../../../model/utils/line-owner";
import { GroupViewKinds } from "../../../../model/utils/remainder";
import { buildBriefViewModel } from "../../../../model/utils/view-model";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../reading/reading-position";
import { deriveGroupSectionId } from "../utils";
import { StoryView } from ".";
import { STORY_CHUNKS_ATTR } from "./StorySplitter/consts";
import { ReviewPostureProvider } from "../../../hooks/useReviewPosture";
import { makeReviewPosture } from "../../../utils/review-posture";
import { MOBILE_QUERY } from "@web/hooks/useMobileViewport";
import { resetMediaQueries, setMediaQueryMatches } from "@web/test/setup";
import {
  DESKTOP_CARD_METRICS,
  estimateChunkCardHeight,
  PHONE_CARD_METRICS,
} from "../reading/chunk-height-model";
import {
  CHUNK_WINDOW_INDEX_ATTR,
  type GroupWindowOptions,
  type useGroupWindow,
} from "../reading/useGroupWindow";

const windowEstimates = vi.hoisted(() => new Map<string, number>());

vi.mock("../reading/useGroupWindow", async (importOriginal) => {
  const original = await importOriginal<{
    useGroupWindow: typeof useGroupWindow;
  }>();
  return {
    ...original,
    useGroupWindow: (options: GroupWindowOptions) => {
      options.chunkKeys.forEach((key, index) => {
        windowEstimates.set(key, options.estimateChunk(index));
      });
      return original.useGroupWindow(options);
    },
  };
});

afterEach(() => {
  windowEstimates.clear();
  resetMediaQueries();
});

const model = buildBriefViewModel(briefFixture);

const remainderBrief = {
  ...briefFixture,
  unattributed: [
    {
      file: "src/orphan.ts",
      addedRanges: [{ start: 1, end: 3 }],
      removedRanges: [{ start: 2, end: 2 }],
      diff: [{ kind: "add" as const, content: "leftover()", newLine: 1 }],
    },
  ],
};
const { remainder, remainderChunk } = resolveRemainder(
  buildBriefViewModel(remainderBrief),
);

function resolveRemainder(view: typeof model) {
  const group = view.groups.find(
    (candidate) => candidate.kind === GroupViewKinds.UNATTRIBUTED_REMAINDER,
  );
  const chunk = group?.chunks[0];
  if (!group || !chunk) {
    throw new Error("expected a remainder group and chunk");
  }
  return { remainder: group, remainderChunk: chunk };
}

/** The Brief on screen and where the reader stands in it. */
interface StorySetup {
  brief: Brief;
  activeChunkId: string;
  activeGroupId: string;
  openChunkIds: string[];
}

const FIXTURE_SETUP: StorySetup = {
  brief: briefFixture,
  activeChunkId: "chunk-a",
  activeGroupId: "g1",
  openChunkIds: ["chunk-a"],
};

const REMAINDER_SETUP: StorySetup = {
  brief: remainderBrief,
  activeChunkId: remainderChunk.id,
  activeGroupId: remainder.id,
  openChunkIds: remainder.chunks.map((chunk) => chunk.id),
};

const comparison: ComparisonOverlayState = {
  compare: "off",
  marks: null,
  source: { kind: "last-review", delta: null },
  skipReason: null,
  available: false,
  runCount: 0,
};

function renderStory(focusMode: boolean, setup: StorySetup = FIXTURE_SETUP) {
  const viewModel = buildBriefViewModel(setup.brief);
  const flowStore = createReviewFlowStore(
    {
      saveComment: () => Promise.resolve(true),
      updateComment: () => Promise.resolve(true),
      deleteComment: () => undefined,
      toggleComment: () => undefined,
      reanchorComment: () => true,
    },
    appI18n.t,
  );
  const positionStore = createReadingPositionStore();
  positionStore
    .getState()
    .actions.setActive(setup.activeChunkId, setup.activeGroupId);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSessionProvider briefId="test-brief" model={viewModel}>
        <ReviewFlowProvider store={flowStore}>
          <ExpansionProvider store={createExpansionStore()}>
            <ReviewPostureProvider posture={makeReviewPosture()}>
              <ReadingPositionProvider store={positionStore}>
                <StoryView
                  brief={setup.brief}
                  chunkActionsFor={undefined}
                  openChunkActions={() => undefined}
                  closeChunkActions={() => undefined}
                  chunkFooter={{ jumpToChunk: vi.fn(), toggleViewed: vi.fn() }}
                  comparison={comparison}
                  focusMode={focusMode}
                  jumpToChunk={() => undefined}
                  lineOwnersByFile={buildLineOwnersByFile(viewModel, appI18n.t)}
                  markReviewed={() => undefined}
                  model={viewModel}
                  openChunks={new Set(setup.openChunkIds)}
                  addressedReviewComments={[]}
                  toggleChunk={() => undefined}
                />
              </ReadingPositionProvider>
            </ReviewPostureProvider>
          </ExpansionProvider>
        </ReviewFlowProvider>
      </ReviewSessionProvider>
    </QueryClientProvider>,
  );
}

function getRemainderRegion(): HTMLElement {
  const section = document.getElementById(deriveGroupSectionId(remainder.id));
  if (!(section instanceof HTMLElement)) {
    throw new Error("expected the remainder section");
  }
  return section;
}

describe("StoryView chunk footer", () => {
  it("renders the footer in focus mode", () => {
    renderStory(true);
    expect(screen.getByTestId("chunk-footer")).toBeTruthy();
  });

  it("leaves the footer out of the story view", () => {
    renderStory(false);
    expect(screen.queryByTestId("chunk-footer")).toBeNull();
  });
});

describe("StoryView chunk column", () => {
  it("gives every windowed card slot its own formatting context", () => {
    renderStory(false);
    const slots = [
      ...document.querySelectorAll<HTMLElement>(
        `[${STORY_CHUNKS_ATTR}] > [${CHUNK_WINDOW_INDEX_ATTR}]`,
      ),
    ];

    expect(slots.length).toBeGreaterThan(0);
    expect(slots.map((slot) => slot.style.display)).toEqual(
      slots.map(() => "flow-root"),
    );
  });

  it("marks each group's chunk column for the splitter", () => {
    renderStory(false);
    const groups = screen.getAllByTestId("story-group");

    expect(groups).toHaveLength(model.groups.length);
    for (const group of groups) {
      const column = group.querySelector(`:scope > [${STORY_CHUNKS_ATTR}]`);
      expect(column).not.toBeNull();
    }
  });
});

/** The page's own h1 sits above the story view, outside this render. */
const PAGE_HEADING_LEVEL = 1;

function readHeadingLevel(heading: HTMLElement): number {
  return Number(heading.tagName.slice(1));
}

describe("StoryView heading outline", () => {
  it("puts each group's h2 before its first chunk's h3", () => {
    renderStory(false, REMAINDER_SETUP);
    const sections = screen
      .getAllByTestId("story-group")
      .filter((section) => section.querySelector("article h3") !== null);

    expect(sections.length).toBeGreaterThanOrEqual(2);
    for (const section of sections) {
      const [groupHeading] = within(section).getAllByRole("heading", {
        level: 2,
      });
      const chunkHeading = section.querySelector(
        '[data-testid="brief-chunk"] h3',
      );
      if (groupHeading === undefined || chunkHeading === null) {
        throw new Error("expected a group heading and a chunk heading");
      }
      const position = groupHeading.compareDocumentPosition(chunkHeading);
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    }
  });

  it("skips no heading level in focus mode", () => {
    renderStory(true);
    const levels = [
      PAGE_HEADING_LEVEL,
      ...screen.getAllByRole("heading").map(readHeadingLevel),
    ];
    const jumps = levels.filter(
      (level, index) => index > 0 && level - (levels[index - 1] ?? 0) > 1,
    );

    expect(levels).toContain(3);
    expect(jumps).toEqual([]);
  });
});

describe("remainder stamps", () => {
  it("renders Story without concern, role, or category text on the remainder", () => {
    renderStory(false, REMAINDER_SETUP);
    const region = getRemainderRegion();

    expect(
      within(region).queryByText(
        appI18n.t("brief.unattributed.remainderTitle"),
      ),
    ).toBeTruthy();
    expect(region.querySelector("[data-concern]")).toBeNull();
    expect(region.querySelector('[data-kind="dominant"]')).toBeNull();
    expect(
      within(region).queryByText(appI18n.t("brief.chunk.roleCore")),
    ).toBeNull();
    const concernLabel = appI18n.t("brief.concern.implementation");
    expect(within(region).queryByText(concernLabel)).toBeNull();
    const categoryLabel = appI18n.t("brief.category.bugfix");
    expect(within(region).queryByText(categoryLabel)).toBeNull();
  });

  it("renders Focus without concern or role stamps on the remainder chunk", () => {
    renderStory(true, REMAINDER_SETUP);
    const region = getRemainderRegion();

    expect(region.querySelector("[data-concern]")).toBeNull();
    expect(
      within(region).queryByText(appI18n.t("brief.chunk.roleCore")),
    ).toBeNull();
  });
});

describe("StoryView windowed cards", () => {
  const collapsedSetup: StorySetup = { ...FIXTURE_SETUP, openChunkIds: [] };
  const chunkKey = "src/leak.ts#chunk-a";

  it("reserves a collapsed card at the desktop head height", () => {
    renderStory(false, collapsedSetup);

    expect(windowEstimates.get(chunkKey)).toBe(
      estimateChunkCardHeight({
        diffRowCount: 0,
        open: false,
        metrics: DESKTOP_CARD_METRICS,
      }),
    );
  });

  it("reserves a collapsed card at the phone's two-line head height", () => {
    setMediaQueryMatches(MOBILE_QUERY, true);
    renderStory(false, collapsedSetup);

    expect(windowEstimates.get(chunkKey)).toBe(
      estimateChunkCardHeight({
        diffRowCount: 0,
        open: false,
        metrics: PHONE_CARD_METRICS,
      }),
    );
  });
});
