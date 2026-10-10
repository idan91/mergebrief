// @vitest-environment jsdom
import { appI18n } from "@web/i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
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
import type { ComparisonOverlayState } from "../../../../model/comparison/comparisonOverlay";
import { briefFixture } from "@web/features/brief/fixtures";
import { buildLineOwnersByFile } from "../../../../model/utils/lineOwner";
import { buildBriefViewModel } from "../../../../model/utils/viewModel";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../readingPosition";
import { StoryView } from ".";
import { STORY_CHUNKS_ATTR } from "./StorySplitter/consts";
import { ReviewPostureProvider } from "../../../hooks/useReviewPosture";
import { makeReviewPosture } from "../../../utils/review-posture";

afterEach(cleanup);

const model = buildBriefViewModel(briefFixture);
const lineOwnersByFile = buildLineOwnersByFile(model, appI18n.t);

const comparison: ComparisonOverlayState = {
  compare: "off",
  marks: null,
  source: { kind: "last-review", delta: null },
  skipReason: null,
  available: false,
  runCount: 0,
};

function renderStory(focusMode: boolean) {
  const flowStore = createReviewFlowStore(
    {
      saveComment: () => Promise.resolve(true),
      updateComment: () => undefined,
      deleteComment: () => undefined,
      toggleComment: () => undefined,
      reanchorComment: () => true,
    },
    appI18n.t,
  );
  const positionStore = createReadingPositionStore();
  positionStore.getState().actions.setActive("chunk-a", "g1");
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSessionProvider briefId="test-brief" model={model}>
        <ReviewFlowProvider store={flowStore}>
          <ExpansionProvider store={createExpansionStore()}>
            <ReviewPostureProvider posture={makeReviewPosture()}>
              <ReadingPositionProvider store={positionStore}>
                <StoryView
                  brief={briefFixture}
                  chunkFooter={{ jumpToChunk: vi.fn(), toggleViewed: vi.fn() }}
                  comparison={comparison}
                  focusMode={focusMode}
                  jumpToChunk={() => undefined}
                  lineOwnersByFile={lineOwnersByFile}
                  markReviewed={() => undefined}
                  model={model}
                  openChunks={new Set(["chunk-a"])}
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
  it.each([false, true])(
    "marks each group's chunk column for the splitter, focus %s",
    (focusMode) => {
      renderStory(focusMode);
      const groups = screen.getAllByTestId("story-group");

      expect(groups).toHaveLength(model.groups.length);
      for (const group of groups) {
        const column = group.querySelector(`:scope > [${STORY_CHUNKS_ATTR}]`);
        expect(column).not.toBeNull();
      }
    },
  );
});
