// @vitest-environment jsdom
// The in-place brief switch at the screen level: with the subtree no longer
// keyed by brief id, screen-local overlay state and the reading session must
// reset explicitly when briefId swaps, an open submit surface or a Viewed
// mark surviving into the next brief is exactly the class of bug the old
// remount masked. Ids collide across briefs on purpose (positional c1..cN).
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { renderStageInRouter } from "../../../../test/router";
import { afterEach, describe, expect, it } from "vitest";

import { EXPANDED_ROW_SELECTOR } from "@web/components/DiffRows/consts";
import { emptySessionPayload } from "@web/features/review/session";
import { makeSessionReadDriver } from "@web/features/review/utils";
import { I18nProvider } from "../../../../i18n/I18nProvider";
import type { BriefSearchParams } from "../../comparison/compareState";
import { buildFileRangeQueryKey, type FileRangeResult } from "../../queries";
import { BriefView } from ".";
import type { Brief, LocalBriefSummary } from "../../types";
import { briefFixture } from "@web/features/brief/fixtures";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

/** A second revision: same chunk/group/flag ids, different sha and content. */
const briefB: Brief = {
  ...briefFixture,
  pr: { ...briefFixture.pr, sha: "b".repeat(40) },
  summary: "A different revision's summary.",
};

async function renderView(briefId: string, brief: Brief) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (id: string, value: Brief) => (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <BriefView
          artifacts={[]}
          brief={value}
          briefId={id}
          searchParams={{}}
        />
      </QueryClientProvider>
    </I18nProvider>
  );
  const stage = await renderStageInRouter(view(briefId, brief), [
    "/briefs/$briefId/summary-preview",
  ]);
  return {
    switchTo: (id: string, value: Brief) => stage.update(view(id, value)),
  };
}

describe("in-place brief switch through the screen", () => {
  it("clears Viewed marks for the same chunk ids in a different brief", async () => {
    const { switchTo } = await renderView("brief-a", briefFixture);
    const viewed = screen.getAllByRole("checkbox", { name: /^Viewed/ })[0];
    if (!viewed) {
      throw new Error("no Viewed checkbox rendered");
    }
    fireEvent.click(viewed);
    expect((viewed as HTMLInputElement).checked).toBe(true);

    switchTo("brief-b", briefB);
    const after = screen.getAllByRole("checkbox", { name: /^Viewed/ })[0];
    expect((after as HTMLInputElement).checked).toBe(false);
  });

  it("drops focus mode and the shortcuts overlay on a brief switch", async () => {
    const { switchTo } = await renderView("brief-a", briefFixture);
    fireEvent.keyDown(window, { key: "?" });
    const shortcuts = document.querySelector(
      '[aria-labelledby="shortcuts-modal-heading"]',
    );
    expect(shortcuts?.closest("[data-state]")).toMatchObject({
      dataset: { state: "open" },
    });

    switchTo("brief-b", briefB);
    expect(shortcuts?.closest("[data-state]")).toMatchObject({
      dataset: { state: "closed" },
    });
  });

  it("closes the submit surface when the brief changes under it", async () => {
    const { switchTo } = await renderView("brief-a", briefFixture);
    const modal = () =>
      document.querySelector('[aria-labelledby="submit-modal-heading"]');
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(modal()?.closest("[data-state]")).toMatchObject({
      dataset: { state: "open" },
    });

    switchTo("brief-b", briefB);
    expect(modal()?.closest("[data-state]")).toMatchObject({
      dataset: { state: "closed" },
    });
  });
});

const REPO_ID = "repo-1";
const EXPANDED_PATH = "src/leak.ts";

function seedLeakFileTop(queryClient: QueryClient, ref: string): void {
  const from = 1;
  const to = 8;
  const lines = Array.from({ length: to }, (_, index) => `L${index + from}`);
  const params = {
    repoId: REPO_ID,
    prNumber: briefFixture.pr.number,
    ref,
    path: EXPANDED_PATH,
    from,
    to,
  };
  const ready: FileRangeResult = {
    kind: "ready",
    range: { path: EXPANDED_PATH, ref, from, to, lines, totalLines: 40 },
  };
  queryClient.setQueryData(buildFileRangeQueryKey(params), ready);
}

/** A full-length head: the range read refuses a short sha. */
const briefA: Brief = {
  ...briefFixture,
  pr: { ...briefFixture.pr, sha: "a".repeat(40) },
};

function countExpandedRows(): number {
  return document.querySelectorAll(EXPANDED_ROW_SELECTOR).length;
}

describe("hunk edge expansion through the screen", () => {
  it("keeps expansion across a session refetch, drops it on a switch", async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    seedLeakFileTop(queryClient, briefA.pr.sha);
    seedLeakFileTop(queryClient, briefB.pr.sha);
    const reads = makeSessionReadDriver();
    const buildView = (id: string, value: Brief) => (
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <BriefView
            artifacts={[]}
            brief={value}
            briefId={id}
            repoId={REPO_ID}
            searchParams={{}}
            session={emptySessionPayload()}
            sessionReads={reads.source}
          />
        </QueryClientProvider>
      </I18nProvider>
    );
    const stage = await renderStageInRouter(buildView("brief-a", briefA), [
      "/briefs/$briefId/summary-preview",
    ]);

    fireEvent.click(
      screen.getByRole("button", { name: "Show all 8 hidden lines above" }),
    );
    await waitFor(() => expect(countExpandedRows()).toBe(8));

    act(() => {
      reads.startRead();
      reads.landRead(emptySessionPayload());
    });
    expect(countExpandedRows()).toBe(8);

    stage.update(buildView("brief-b", briefB));
    expect(countExpandedRows()).toBe(0);
  });
});

/** One timeline summary granting brief-a a previous-brief comparison,
 * a single point, so the router-dependent prev/next links never render. */
const artifactSummaries: LocalBriefSummary[] = [
  {
    id: "brief-a",
    artifactKind: "brief",
    repo: briefFixture.pr.repo,
    number: briefFixture.pr.number,
    title: briefFixture.pr.title,
    sha: briefFixture.pr.sha,
    index: 1,
    comparisons: {
      previousBrief: {
        marksId: "marks-a",
        baselineSha: "0".repeat(40),
        baselineIndex: 0,
      },
    },
  },
];

describe("kept-warm scope panes", () => {
  async function renderScoped(searchParams: BriefSearchParams) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = (id: string, value: Brief, params: BriefSearchParams) => (
      <I18nProvider>
        <QueryClientProvider client={queryClient}>
          <BriefView
            artifacts={artifactSummaries}
            brief={value}
            briefId={id}
            searchParams={params}
          />
        </QueryClientProvider>
      </I18nProvider>
    );
    const stage = await renderStageInRouter(
      view("brief-a", briefFixture, searchParams),
      ["/briefs/$briefId/summary-preview"],
    );
    return {
      rerenderWith: (id: string, value: Brief, params: BriefSearchParams) =>
        stage.update(view(id, value, params)),
    };
  }

  // The pane's marker: with no narrative fetchable in jsdom, the changes
  // pane renders its unavailable empty state, presence in the DOM is what
  // the keep-warm latch controls.
  const changesPane = () => {
    const lead = [...document.querySelectorAll("b")].find(
      (node) => node.textContent === "Revision summary unavailable.",
    );
    return lead ?? null;
  };

  it("keeps the changes pane hidden after leaving scope, drops it on switch", async () => {
    const { rerenderWith } = await renderScoped({
      view: "changes",
      compare: "previous-brief",
    });
    expect(changesPane()).not.toBeNull();
    expect(changesPane()?.closest("[hidden]")).toBeNull();

    // Back to full scope: still in the DOM, the flip back must not pay a
    // remount, but display:none'd out of paint and the AT tree.
    rerenderWith("brief-a", briefFixture, {});
    expect(changesPane()).not.toBeNull();
    expect(changesPane()?.closest("[hidden]")).not.toBeNull();

    // Latches reset on a brief switch: the hidden pane is unmounted, never
    // kept against the re-derived stores.
    rerenderWith("brief-b", briefB, {});
    expect(changesPane()).toBeNull();
  });
});
