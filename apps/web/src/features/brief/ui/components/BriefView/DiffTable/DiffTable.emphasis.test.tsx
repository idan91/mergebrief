// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { appI18n } from "../../../../../../i18n/I18nProvider";
import type { ThreadComposerWiring } from "@web/features/conversation";
import {
  createReviewFlowStore,
  ReviewFlowProvider,
  ReviewSessionProvider,
} from "@web/features/review/session";
import type { RowTokenMap } from "@web/utils/diffTokens/types";
import type { Brief, BriefChunk } from "../../../../model/types";
import { buildBriefViewModel } from "../../../../model/utils/view-model";
import { DiffTable } from ".";
import type { DiffTableProps } from "./types";
import { ReviewPostureProvider } from "../../../hooks/useReviewPosture";
import { makeReviewPosture } from "../../../utils/review-posture";

afterEach(cleanup);

function stubChunk(): BriefChunk {
  return {
    id: "c1",
    changeGroupId: "g1",
    file: "src/a.ts",
    concern: "implementation",
    role: "core",
    loc: { added: 1, deleted: 1 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    diff: [
      { kind: "del", content: "const a = 1;", oldLine: 10 },
      { kind: "add", content: "const a = 2;", newLine: 10 },
    ],
  } as BriefChunk;
}

function stubTokens(...texts: string[]) {
  return texts.map((text) => ({ text, classId: 0 }));
}

const tokensByRow: RowTokenMap = new Map([
  [0, stubTokens("const", " ", "a", " = ", "1", ";")],
  [1, stubTokens("const", " ", "a", " = ", "2", ";")],
]);

function stubComposer(): ThreadComposerWiring {
  return {
    post: vi.fn(async () => ({ kind: "posted", commentId: 1 }) as const),
    onPosted: vi.fn(),
  };
}

const providerBrief: Brief = {
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
  chunks: [stubChunk()],
  concernView: [],
};

function renderTable(view: NonNullable<DiffTableProps["view"]>) {
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
  const props: DiffTableProps = {
    chunk: stubChunk(),
    comparisonView: { marks: new Map(), runs: [], runByRow: new Map() },
    comparisonSource: { kind: "last-review", delta: null },
    comparisonSkipReason: null,
    addressedComments: [],
    conversationThreadsByRow: new Map(),
    conversationComposer: stubComposer(),
    reviewCommentLabel: "review comment",
    tokensByRow,
    view,
  };

  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSessionProvider
        briefId="test-brief"
        model={buildBriefViewModel(providerBrief)}
      >
        <ReviewFlowProvider store={flowStore}>
          <ReviewPostureProvider posture={makeReviewPosture()}>
            <DiffTable {...props} />
          </ReviewPostureProvider>
        </ReviewFlowProvider>
      </ReviewSessionProvider>
    </QueryClientProvider>,
  );
}

describe("DiffTable intra-line emphasis", () => {
  it("marks the changed characters of a del/add pair in unified view", () => {
    const view = renderTable("unified");
    const marks = view.container.querySelectorAll("mark");

    expect(view.container.querySelector("table")?.dataset["view"]).toBe(
      "unified",
    );
    expect([...marks].map((mark) => mark.textContent)).toEqual(["1", "2"]);
  });

  it("marks the same characters inside the split cells", () => {
    const view = renderTable("split");
    const left = view.container.querySelector('td[data-side="left"] mark');
    const right = view.container.querySelector('td[data-side="right"] mark');

    expect(view.container.querySelector("table")?.dataset["view"]).toBe(
      "split",
    );
    expect(left?.textContent).toBe("1");
    expect(right?.textContent).toBe("2");
  });
});
