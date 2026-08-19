// @vitest-environment jsdom
import { appI18n } from "../../../../../i18n/I18nProvider";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createReviewFlowStore,
  initialReviewFlowState,
  ReviewSessionProvider,
  ReviewFlowProvider,
} from "@web/features/review/session";
import type { Brief } from "../../../types";
import { buildBriefViewModel } from "../../../utils/viewModel";
import type { UnattributedView } from "../../../utils/viewModel";
import { UnattributedBanner } from "./UnattributedBanner";

afterEach(cleanup);

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
  chunks: [],
  concernView: [],
};

function renderBanner(view: UnattributedView) {
  const flowStore = createReviewFlowStore(
    {
      saveComment: vi.fn(),
      updateComment: vi.fn(),
      deleteComment: vi.fn(),
      toggleComment: vi.fn(),
    },
    initialReviewFlowState({
      composerDisabledReason: undefined,
      flagsReadOnly: false,
      postingCommentIds: new Set(),
      postBlockedExternally: undefined,
      postComment: undefined,
    }),
    appI18n.t,
  );
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ReviewSessionProvider
        briefId="test-brief"
        model={buildBriefViewModel(providerBrief)}
      >
        <ReviewFlowProvider store={flowStore}>
          <UnattributedBanner view={view} />
        </ReviewFlowProvider>
      </ReviewSessionProvider>
    </QueryClientProvider>,
  );
}

const view: UnattributedView = {
  files: [
    {
      file: "src/orphan.ts",
      addedRanges: [{ start: 3, end: 6 }],
      removedRanges: [],
      added: 4,
      deleted: 0,
      diff: [
        { kind: "hunk", content: "@@ -1,8 +1,10 @@" },
        { kind: "add", content: "const a = 1;", newLine: 3 },
        { kind: "add", content: "const b = 2;", newLine: 4 },
      ],
    },
    {
      file: "src/other.ts",
      addedRanges: [],
      removedRanges: [{ start: 9, end: 10 }],
      added: 0,
      deleted: 2,
    },
  ],
  added: 4,
  deleted: 2,
};

describe("UnattributedBanner", () => {
  it("shows the counts and file total, collapsed by default", () => {
    renderBanner(view);
    const banner = screen.getByTestId("unattributed-banner");
    expect(banner.dataset["state"]).toBe("closed");
    expect(banner.textContent).toContain("+4");
    expect(banner.textContent).toContain("−2");
    expect(banner.textContent).toContain(
      "changed lines in 2 files are not covered by any chunk.",
    );
    const toggle = screen.getByTestId("unattributed-banner-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toBe("Show lines");
  });

  it("expands to per-file rows and flips the toggle copy", () => {
    renderBanner(view);
    fireEvent.click(screen.getByTestId("unattributed-banner-toggle"));
    const banner = screen.getByTestId("unattributed-banner");
    expect(banner.dataset["state"]).toBe("open");
    expect(screen.getByText("Hide lines")).toBeTruthy();
    expect(screen.getByText("src/orphan.ts")).toBeTruthy();
    expect(banner.textContent).toContain("lines 3–6");
    expect(banner.textContent).toContain("lines 9–10");
  });

  it("renders the file's diff rows on expansion, read-only", () => {
    renderBanner(view);
    fireEvent.click(screen.getByTestId("unattributed-banner-toggle"));
    const [firstFile] = screen.getAllByRole("button", { expanded: false });
    expect(firstFile).toBeTruthy();
    if (!firstFile) return;
    fireEvent.click(firstFile);
    expect(screen.getByText("const a = 1;")).toBeTruthy();
    expect(screen.getByText("const b = 2;")).toBeTruthy();
  });

  it("degrades to the no-diff note when rows are unavailable", () => {
    renderBanner(view);
    fireEvent.click(screen.getByTestId("unattributed-banner-toggle"));
    const other = screen.getByRole("button", { name: /other\.ts/ });
    fireEvent.click(other);
    expect(
      screen.getByText("Diff lines are not available for this file."),
    ).toBeTruthy();
  });
});
