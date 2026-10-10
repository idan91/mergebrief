// @vitest-environment jsdom
// The in-place brief switch at the screen level: with the subtree no longer
// keyed by brief id, screen-local overlay state and the reading session must
// reset explicitly when briefId swaps, an open submit surface or a Viewed
// mark surviving into the next brief is exactly the class of bug the old
// remount masked. Ids collide across briefs on purpose (positional c1..cN).
import { QueryClient } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EXPANDED_ROW_SELECTOR } from "@web/components/DiffRows/consts";
import { emptySessionPayload } from "@web/features/review/session";
import { makeSessionReadDriver } from "@web/features/review/utils";
import { buildFileRangeQueryKey, type FileRangeResult } from "../../../queries";
import type {
  Brief,
  LocalBriefSummary,
  PostCommentResult,
} from "../../../model/types";
import { briefFixture } from "@web/features/brief/fixtures";
import { mountBriefView } from "../../../test-utils";

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

describe("in-place brief switch through the screen", () => {
  it("clears Viewed marks for the same chunk ids in a different brief", async () => {
    const view = await mountBriefView({ briefId: "brief-a" });
    const viewed = screen.getAllByRole("checkbox", { name: /^Viewed/ })[0];
    if (!viewed) {
      throw new Error("no Viewed checkbox rendered");
    }
    fireEvent.click(viewed);
    expect((viewed as HTMLInputElement).checked).toBe(true);

    view.rerender({ briefId: "brief-b", brief: briefB });
    const after = screen.getAllByRole("checkbox", { name: /^Viewed/ })[0];
    expect((after as HTMLInputElement).checked).toBe(false);
  });

  it("drops focus mode and the shortcuts overlay on a brief switch", async () => {
    const view = await mountBriefView({ briefId: "brief-a" });
    fireEvent.keyDown(window, { key: "?" });
    const shortcuts = document.querySelector(
      '[aria-labelledby="shortcuts-modal-heading"]',
    );
    expect(shortcuts?.closest("[data-state]")).toMatchObject({
      dataset: { state: "open" },
    });

    view.rerender({ briefId: "brief-b", brief: briefB });
    expect(shortcuts?.closest("[data-state]")).toMatchObject({
      dataset: { state: "closed" },
    });
  });

  it("closes the submit surface when the brief changes under it", async () => {
    const view = await mountBriefView({ briefId: "brief-a" });
    const modal = () =>
      document.querySelector('[aria-labelledby="submit-modal-heading"]');
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(modal()?.closest("[data-state]")).toMatchObject({
      dataset: { state: "open" },
    });

    view.rerender({ briefId: "brief-b", brief: briefB });
    expect(modal()?.closest("[data-state]")).toMatchObject({
      dataset: { state: "closed" },
    });
  });

  it("reopens a chunk the last brief collapsed", async () => {
    const view = await mountBriefView({ briefId: "brief-a" });
    const getFirstChunkToggle = () => screen.getAllByTestId("chunk-toggle")[0];
    fireEvent.click(getFirstChunkToggle() as HTMLElement);
    expect(getFirstChunkToggle()?.getAttribute("aria-expanded")).toBe("false");

    view.rerender({ briefId: "brief-b", brief: briefB });
    expect(getFirstChunkToggle()?.getAttribute("aria-expanded")).toBe("true");
  });

  it("leaves focus mode when the brief changes", async () => {
    const view = await mountBriefView({ briefId: "brief-a" });
    const getMainContent = () => document.getElementById("main-content");
    fireEvent.keyDown(window, { key: "z" });
    expect(getMainContent()?.dataset["zen"]).toBe("on");

    view.rerender({ briefId: "brief-b", brief: briefB });
    expect(getMainContent()?.dataset["zen"]).toBeUndefined();
  });
});

/** The own-draft gate's Modal state, read off its heading. */
function readGateState(): string | undefined {
  return (
    screen
      .getByText("Before marking ready")
      .closest("[data-state]")
      ?.getAttribute("data-state") ?? undefined
  );
}

function makeDraft(
  id: string,
): ReturnType<typeof emptySessionPayload>["draftComments"][number] {
  return {
    id,
    kind: "line",
    filePath: "src/leak.ts",
    side: "new",
    startLine: 10,
    endLine: 10,
    body: `${id} body`,
    status: "draft",
  };
}

describe("mark-ready gate across a brief switch", () => {
  it("closes the gate when the brief changes under it", async () => {
    const view = await mountBriefView({
      briefId: "brief-a",
      ownDraft: { markReady: vi.fn() },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(readGateState()).toBe("open");

    view.rerender({ briefId: "brief-b", brief: briefB });
    expect(readGateState()).toBe("closed");
  });

  it("drops a running batch's progress when the brief changes", async () => {
    const session = {
      ...emptySessionPayload(),
      draftComments: [makeDraft("d1"), makeDraft("d2")],
    };
    const view = await mountBriefView({
      briefId: "brief-a",
      session,
      ownDraft: {
        markReady: vi.fn(),
        postComment: vi.fn(() => new Promise<PostCommentResult>(() => {})),
      },
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    fireEvent.click(
      screen.getByRole("checkbox", { name: /post my 2 draft comments/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Mark ready anyway" }));
    expect(
      await screen.findByRole("button", { name: "Posting 1 of 2…" }),
    ).toBeTruthy();

    view.rerender({ briefId: "brief-b", brief: briefB, session });
    fireEvent.click(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    expect(readGateState()).toBe("open");
    expect(
      screen.queryByRole("button", { name: "Posting 1 of 2…" }),
    ).toBeNull();
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
    const view = await mountBriefView(
      {
        brief: briefA,
        briefId: "brief-a",
        repoId: REPO_ID,
        session: emptySessionPayload(),
        sessionReads: reads.source,
      },
      { queryClient },
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Show all 8 hidden lines above" }),
    );
    await waitFor(() => expect(countExpandedRows()).toBe(8));

    act(() => {
      reads.startRead();
      reads.landRead(emptySessionPayload());
    });
    expect(countExpandedRows()).toBe(8);

    view.rerender({
      brief: briefB,
      briefId: "brief-b",
      session: emptySessionPayload(),
    });
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

/** The second revision on the same timeline, with its own previous-brief comparison. */
const briefBSummary: LocalBriefSummary = {
  id: "brief-b",
  artifactKind: "brief",
  repo: briefFixture.pr.repo,
  number: briefFixture.pr.number,
  title: briefFixture.pr.title,
  sha: briefB.pr.sha,
  index: 2,
  comparisons: {
    previousBrief: {
      marksId: "marks-b",
      baselineSha: briefFixture.pr.sha,
      baselineIndex: 1,
    },
  },
};

describe("kept-warm scope panes", () => {
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
    const view = await mountBriefView({
      artifacts: artifactSummaries,
      briefId: "brief-a",
      searchParams: { view: "changes", compare: "previous-brief" },
    });
    expect(changesPane()).not.toBeNull();
    expect(changesPane()?.closest("[hidden]")).toBeNull();

    // Back to full scope: still in the DOM, the flip back must not pay a
    // remount, but display:none'd out of paint and the AT tree.
    view.rerender({ searchParams: {} });
    expect(changesPane()).not.toBeNull();
    expect(changesPane()?.closest("[hidden]")).not.toBeNull();

    // Latches reset on a brief switch: the hidden pane is unmounted, never
    // kept against the re-derived stores.
    view.rerender({ brief: briefB, briefId: "brief-b", searchParams: {} });
    expect(changesPane()).toBeNull();
  });

  it("drops the story pane kept behind Changes scope on a switch", async () => {
    const queryStoryChunk = () =>
      document.querySelector('[data-testid="brief-chunk"]');
    const changesSearch = {
      view: "changes",
      compare: "previous-brief",
    } as const;
    const view = await mountBriefView({
      artifacts: [...artifactSummaries, briefBSummary],
      briefId: "brief-a",
    });
    expect(queryStoryChunk()).not.toBeNull();

    view.rerender({ searchParams: changesSearch });
    expect(changesPane()).not.toBeNull();
    expect(queryStoryChunk()?.closest("[hidden]")).not.toBeNull();

    view.rerender({
      brief: briefB,
      briefId: "brief-b",
      searchParams: changesSearch,
    });
    expect(changesPane()).not.toBeNull();
    expect(queryStoryChunk()).toBeNull();
  });
});
