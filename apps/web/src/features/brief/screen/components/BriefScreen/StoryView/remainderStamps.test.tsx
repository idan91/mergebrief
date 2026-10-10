// @vitest-environment jsdom
import { appI18n } from "@web/i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import {
  createReviewFlowStore,
  ReviewFlowProvider,
  ReviewSessionProvider,
} from "@web/features/review/session";
import {
  createExpansionStore,
  ExpansionProvider,
} from "../../../../model/hooks/useExpansion";
import type { ComparisonOverlayState } from "../../../../model/comparison/comparisonOverlay";
import { briefFixture } from "@web/features/brief/fixtures";
import { buildLineOwnersByFile } from "../../../../model/utils/lineOwner";
import { GroupViewKinds } from "../../../../model/utils/remainder";
import { buildBriefViewModel } from "../../../../model/utils/viewModel";
import {
  createReadingPositionStore,
  ReadingPositionProvider,
} from "../readingPosition";
import { deriveGroupSectionId } from "../utils";
import { StoryView } from ".";
import { ReviewPostureProvider } from "../../../hooks/useReviewPosture";
import { makeReviewPosture } from "../../../utils/review-posture";

afterEach(cleanup);

const brief = {
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
const model = buildBriefViewModel(brief);
const lineOwnersByFile = buildLineOwnersByFile(model, appI18n.t);
const { remainder, remainderChunk } = resolveRemainder(model);

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
  positionStore.getState().actions.setActive(remainderChunk.id, remainder.id);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSessionProvider briefId="test-brief" model={model}>
        <ReviewFlowProvider store={flowStore}>
          <ExpansionProvider store={createExpansionStore()}>
            <ReviewPostureProvider posture={makeReviewPosture()}>
              <ReadingPositionProvider store={positionStore}>
                <StoryView
                  brief={brief}
                  comparison={comparison}
                  focusMode={focusMode}
                  jumpToChunk={() => undefined}
                  lineOwnersByFile={lineOwnersByFile}
                  markReviewed={() => undefined}
                  model={model}
                  openChunks={
                    new Set(remainder.chunks.map((chunk) => chunk.id))
                  }
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

function remainderRegion(): HTMLElement {
  const section = document.getElementById(deriveGroupSectionId(remainder.id));
  if (!(section instanceof HTMLElement)) {
    throw new Error("expected the remainder section");
  }
  return section;
}

function assertNoStamps(region: HTMLElement) {
  expect(
    within(region).queryByText(appI18n.t("brief.unattributed.remainderTitle")),
  ).toBeTruthy();
  expect(region.querySelector("[data-concern]")).toBeNull();
  expect(region.querySelector('[data-kind="dominant"]')).toBeNull();
  expect(
    within(region).queryByText(appI18n.t("brief.chunk.roleCore")),
  ).toBeNull();
  expect(within(region).queryByText("implementation")).toBeNull();
  expect(within(region).queryByText("bugfix")).toBeNull();
}

describe("remainder stamps", () => {
  it("renders Story without concern, role, or category text on the remainder", () => {
    renderStory(false);
    const region = remainderRegion();
    expect(region).toBeTruthy();
    assertNoStamps(region);
  });

  it("renders Focus without concern or role stamps on the remainder chunk", () => {
    renderStory(true);
    const region = remainderRegion();
    expect(region.querySelector("[data-concern]")).toBeNull();
    expect(
      within(region).queryByText(appI18n.t("brief.chunk.roleCore")),
    ).toBeNull();
  });
});
