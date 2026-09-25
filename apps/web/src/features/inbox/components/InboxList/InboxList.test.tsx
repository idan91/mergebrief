// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import { InboxLayouts, InboxReviewStates, InboxSorts } from "types/inbox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderInRouter, renderStageInRouter } from "../../../../test/router";
import type { InboxItem } from "../../types";
import { InboxList } from "./InboxList";

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn() })),
  );
});

function makeItem(overrides: Partial<InboxItem> = {}): InboxItem {
  return {
    repoId: "424242",
    repoSlug: "acme/payments",
    prNumber: 7,
    title: "Retry failed webhook deliveries",
    state: "open",
    draft: false,
    source: "installation",
    installationId: "10",
    viewerIsAuthor: false,
    viewerCanDelete: false,
    reviewState: InboxReviewStates.NEW,
    behind: false,
    unreachable: false,
    generation: { status: "succeeded", updatedAt: "2026-09-20T10:00:00Z" },
    latestBriefAt: "2026-09-20T10:00:00Z",
    githubUpdatedAt: "2026-09-20T09:00:00Z",
    stack: null,
    ...overrides,
  };
}

function readRows() {
  return screen.getAllByTestId("inbox-row");
}

function readRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }
  if (input instanceof URL) {
    return input.href;
  }
  return input.url;
}

function readSelectionStatus(): string | null {
  return screen.getByTestId("selection-status").textContent;
}

/** Open the row menu the way a pointer does: the press focuses the trigger first. */
async function openRowMenu(): Promise<HTMLElement> {
  const trigger = screen.getByRole("button", { name: "More actions" });
  await act(async () => {
    trigger.focus();
    fireEvent.click(trigger);
  });
  return trigger;
}

/** Two pages of two rows, none deletable; every other request answers ok. */
/** Answers two pages of two rows; page two waits on the gate when one is given. */
function answerMatchingPages(pageTwoGate?: Promise<void>): void {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(readRequestUrl(input), "http://x");
    if (url.pathname === "/api/inbox") {
      const page = url.searchParams.get("page") ?? "1";
      if (page === "2" && pageTwoGate !== undefined) {
        await pageTwoGate;
      }
      const numbers = page === "2" ? [3, 4] : [1, 2];
      return new Response(
        JSON.stringify({
          items: numbers.map((prNumber) => ({
            ...makeItem({ prNumber, title: `PR ${String(prNumber)}` }),
            generation: null,
          })),
          page: Number(page),
          pageSize: 2,
          total: 4,
          archivedTotal: 0,
          counts: { new: 4, inProgress: 0, reviewed: 0, updated: 0 },
          viewer: { login: "octocat", avatarUrl: "https://a/1" },
          reachableInstallations: [],
          repositories: [{ repoId: "424242", repoSlug: "acme/payments" }],
          installUrl: null,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response('{"ok":true}', { status: 200 });
  });
}

describe("InboxList", () => {
  it("splits at the fold and keeps the server order on each side", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, reviewState: InboxReviewStates.REVIEWED }),
          makeItem({ prNumber: 2, reviewState: InboxReviewStates.UPDATED }),
          makeItem({ prNumber: 3, reviewState: null, viewerIsAuthor: true }),
          makeItem({ prNumber: 4, reviewState: InboxReviewStates.NEW }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    const rows = readRows();
    expect(rows.map((row) => within(row).getByText(/#\d/).textContent)).toEqual(
      ["#2", "#4", "#1", "#3"],
    );
    expect(screen.getByText("Not waiting on you")).toBeTruthy();
    expect(rows[0]?.getAttribute("data-needs-you")).toBe("true");
    expect(rows[2]?.getAttribute("data-needs-you")).toBe("false");
  });

  it("the first-load stagger is keyed on the wrapper holding both cards", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, reviewState: InboxReviewStates.NEW }),
          makeItem({ prNumber: 2, reviewState: InboxReviewStates.REVIEWED }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    const wrapper = document.querySelector("[data-first-load]");
    expect(wrapper?.querySelectorAll("ol").length).toBe(2);
  });

  it("the mixed layout is one list in the server order with no fold", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, reviewState: InboxReviewStates.REVIEWED }),
          makeItem({ prNumber: 2, reviewState: InboxReviewStates.UPDATED }),
          makeItem({ prNumber: 3, reviewState: null, viewerIsAuthor: true }),
        ]}
        layout={InboxLayouts.MIXED}
        sort={InboxSorts.UPDATED}
      />,
    );

    const rows = readRows();
    expect(rows.map((row) => within(row).getByText(/#\d/).textContent)).toEqual(
      ["#1", "#2", "#3"],
    );
    expect(screen.queryByText("Not waiting on you")).toBeNull();
    expect(screen.getAllByRole("list")).toHaveLength(1);
  });

  it("shows no fold line when every row sits on one side", async () => {
    await renderInRouter(
      <InboxList
        items={[makeItem({ prNumber: 1 }), makeItem({ prNumber: 2 })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    expect(screen.queryByText("Not waiting on you")).toBeNull();
  });

  it("each row is one link to the brief, named by its title", async () => {
    await renderInRouter(
      <InboxList
        items={[makeItem({ title: "Rename `balance_minor` everywhere" })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    const link = screen.getByRole("link", {
      name: /Rename balance_minor everywhere/,
    });
    expect(link.getAttribute("href")).toBe("/repos/424242/pulls/7");
    expect(within(link).getByText("balance_minor").tagName).toBe("CODE");
  });

  it("prints the status only when it is not Open", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1 }),
          makeItem({ prNumber: 2, draft: true }),
          makeItem({ prNumber: 3, state: "merged" }),
          makeItem({ prNumber: 4, state: "closed" }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    const rows = readRows();
    expect(within(rows[0]!).queryByText("Open")).toBeNull();
    expect(within(rows[1]!).getByText("Draft")).toBeTruthy();
    expect(within(rows[2]!).getByText("Merged")).toBeTruthy();
    expect(within(rows[3]!).getByText("Closed")).toBeTruthy();
  });

  it("names the mark, the source and the chips for assistive technology", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({
            source: "url",
            installationId: null,
            reviewState: InboxReviewStates.IN_PROGRESS,
            stack: { index: 2, size: 4 },
            unreachable: true,
          }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    const row = readRows()[0]!;
    const link = within(row).getByRole("link", {
      name: /^In progress\. Open\. Added from a URL\./,
    });
    expect(link.querySelector("[data-review]")).not.toBeNull();
    expect(within(row).getByText("Place in a stack: 2 of 4")).toBeTruthy();
    expect(
      within(row).getByText("GitHub no longer shows this pull request to you"),
    ).toBeTruthy();
    expect(row.getAttribute("data-unreachable")).toBe("true");
  });

  it("the row link is named by its states before its title", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({
            source: "url",
            installationId: null,
            draft: true,
            generation: {
              status: "pending",
              updatedAt: "2026-09-20T10:00:00Z",
            },
            title: "Retry deliveries",
          }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    expect(
      screen.getByRole("link", {
        name: /^New\. Draft\. Queued\. Added from a URL\. Retry deliveries/,
      }),
    ).toBeTruthy();
  });

  it("a row behind GitHub carries the new-commits chip in its name", async () => {
    await renderInRouter(
      <InboxList
        items={[makeItem({ behind: true })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    expect(
      screen.getByRole("link", {
        name: /GitHub has commits this brief does not cover\./,
      }),
    ).toBeTruthy();
    expect(screen.getByText("new commits")).toBeTruthy();
  });

  it("j moves the keyboard cursor and Enter opens the row under it", async () => {
    const { router } = await renderInRouter(
      <InboxList
        items={[makeItem({ prNumber: 1 }), makeItem({ prNumber: 2 })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });

    const rows = readRows();
    expect(rows[0]?.getAttribute("data-cursor")).toBe("false");
    expect(rows[1]?.getAttribute("data-cursor")).toBe("true");

    await act(async () => {
      fireEvent.keyDown(window, { key: "Enter" });
    });
    await waitFor(() => {
      expect(router.state.location.pathname).toBe("/repos/424242/pulls/2");
    });
  });

  it("the cursor row scrolls into view at once, never smoothly", async () => {
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    await renderInRouter(
      <InboxList
        items={[makeItem({ prNumber: 1 }), makeItem({ prNumber: 2 })]}
        layout={InboxLayouts.FOLDED}
        sort={InboxSorts.UPDATED}
      />,
    );

    fireEvent.keyDown(window, { key: "j" });

    expect(scrollIntoView).toHaveBeenLastCalledWith({
      block: "nearest",
      behavior: "instant",
    });
    scrollIntoView.mockRestore();
  });

  it("Enter on a control inside a row leaves that control alone", async () => {
    const { router } = await renderInRouter(
      <InboxList
        items={[makeItem({ prNumber: 1 })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    fireEvent.keyDown(window, { key: "j" });
    const more = screen.getByRole("button", { name: "More actions" });

    fireEvent.keyDown(more, { key: "Enter" });

    expect(router.state.location.pathname).toBe("/");
  });

  it("deleting a row lands focus on the heading and announces it", async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await renderInRouter(
      <InboxList
        items={[
          makeItem({
            source: "url",
            viewerIsAuthor: true,
            viewerCanDelete: true,
          }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    await openRowMenu();

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    });
    const dialog = screen.getByRole("dialog");
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(dialog).getByRole("button", { name: "Cancel" }),
      );
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 2, name: "Briefs" }),
      );
      expect(screen.getByText("Deleted")).toBeTruthy();
    });
  });

  it("cancelling the delete modal returns focus to the row's menu trigger", async () => {
    await renderInRouter(
      <InboxList
        items={[makeItem({ viewerCanDelete: true })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    const trigger = await openRowMenu();
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
    expect(readRows()).toHaveLength(1);
  });

  it("every row carries a checkbox named after it, outside the row link", async () => {
    await renderInRouter(
      <InboxList
        items={[makeItem({ prNumber: 1, title: "Alpha" })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    const box = screen.getByRole("checkbox", { name: "Select Alpha" });
    expect(box.closest("a")).toBeNull();
    expect(readSelectionStatus()).toBe("Nothing selected");
    const status = screen.getByTestId("selection-status");
    expect(status.getAttribute("aria-live")).toBe("polite");
    await act(async () => {
      fireEvent.click(box);
    });
    expect(readRows()[0]?.getAttribute("data-selected")).toBe("true");
    expect(readSelectionStatus()).toBe("1 selected");
    expect(
      within(screen.getByTestId("selection-header")).getByText("1 selected"),
    ).toBeTruthy();
  });

  it("x toggles the cursor row and the page checkbox selects them all", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "Alpha" }),
          makeItem({ prNumber: 2, title: "Beta" }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    await act(async () => {
      fireEvent.keyDown(window, { key: "j" });
    });
    await act(async () => {
      fireEvent.keyDown(window, { key: "x" });
    });
    expect(readSelectionStatus()).toBe("1 selected");
    const page = screen.getByRole("checkbox", {
      name: "Select all on this page",
    });
    expect(page.getAttribute("aria-checked")).toBe("mixed");

    await act(async () => {
      fireEvent.click(page);
    });
    expect(readSelectionStatus()).toBe("2 selected");
    expect(readRows().map((row) => row.getAttribute("data-selected"))).toEqual([
      "true",
      "true",
    ]);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    });
    expect(readSelectionStatus()).toBe("Nothing selected");
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 2, name: "Briefs" }),
      );
    });
  });

  it("a shift-click ticks the span since the last toggle", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "Alpha" }),
          makeItem({ prNumber: 2, title: "Beta" }),
          makeItem({ prNumber: 3, title: "Gamma" }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Gamma" }), {
        shiftKey: true,
      });
    });

    expect(readSelectionStatus()).toBe("3 selected");
  });

  it("selecting every matching row acts on the pages beyond this one", async () => {
    const page1 = makeItem({ prNumber: 1, title: "Alpha" });
    answerMatchingPages();
    await renderInRouter(
      <InboxList
        items={[page1, makeItem({ prNumber: 2, title: "Beta" })]}
        pageSize={2}
        params={{}}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
        total={4}
      />,
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Select all on this page" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Select all 4 matching" }),
      );
    });
    expect(readSelectionStatus()).toBe("All 4 matching selected");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive 4" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Archived 4")).toBeTruthy();
    });
    const archived = fetchMock.mock.calls
      .map(([input]) => readRequestUrl(input ?? ""))
      .filter((url) => url.includes("/archive"));
    expect(archived).toHaveLength(4);
    expect(readSelectionStatus()).toBe("Nothing selected");
  });

  it("unticking a row after selecting every match acts on the ticks alone", async () => {
    answerMatchingPages();
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "Alpha" }),
          makeItem({ prNumber: 2, title: "Beta" }),
        ]}
        pageSize={2}
        params={{}}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
        total={4}
      />,
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Select all on this page" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Select all 4 matching" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Beta" }));
    });
    expect(readSelectionStatus()).toBe("1 selected");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive 1" }));
    });

    await waitFor(() => {
      expect(screen.getByText("Archived 1")).toBeTruthy();
    });
    const archived = fetchMock.mock.calls
      .map(([input]) => readRequestUrl(input ?? ""))
      .filter((url) => url.includes("/archive"));
    expect(archived).toHaveLength(1);
    expect(archived[0]).toContain("/pulls/1/");
  });

  it("a matching delete with nothing deletable says so and opens nothing", async () => {
    answerMatchingPages();
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "Alpha" }),
          makeItem({ prNumber: 2, title: "Beta" }),
        ]}
        pageSize={2}
        params={{}}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
        total={4}
      />,
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Select all on this page" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Select all 4 matching" }),
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete matching" }));
    });

    await waitFor(() => {
      expect(
        screen.getByText("None of the 4 matching rows can be deleted"),
      ).toBeTruthy();
    });
    const closed = screen
      .getByRole("dialog", { hidden: true })
      .closest("[data-state]");
    expect(closed?.getAttribute("data-state")).toBe("closed");
  });

  it("a matching read that fails is announced, and nothing is archived", async () => {
    fetchMock.mockImplementation(
      async () => new Response("{}", { status: 500 }),
    );
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "Alpha" }),
          makeItem({ prNumber: 2, title: "Beta" }),
        ]}
        pageSize={2}
        params={{}}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
        total={4}
      />,
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Select all on this page" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Select all 4 matching" }),
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive 4" }));
    });

    await waitFor(() => {
      expect(
        screen.getByText("The matching rows could not be read. Try again."),
      ).toBeTruthy();
    });
    const archived = fetchMock.mock.calls
      .map(([input]) => readRequestUrl(input ?? ""))
      .filter((url) => url.includes("/archive"));
    expect(archived).toHaveLength(0);
  });

  it("a tick during the matching read drops the action and says so", async () => {
    let openGate: () => void = () => {};
    answerMatchingPages(
      new Promise<void>((resolve) => {
        openGate = resolve;
      }),
    );
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "Alpha" }),
          makeItem({ prNumber: 2, title: "Beta" }),
        ]}
        pageSize={2}
        params={{}}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
        total={4}
      />,
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Select all on this page" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Select all 4 matching" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive 4" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    });
    expect(readSelectionStatus()).toBe("1 selected");
    await act(async () => {
      openGate();
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "The selection changed while the matching rows were being read. Nothing was done.",
        ),
      ).toBeTruthy();
    });
    const archived = fetchMock.mock.calls
      .map(([input]) => readRequestUrl(input ?? ""))
      .filter((url) => url.includes("/archive"));
    expect(archived).toHaveLength(0);
    expect(screen.getByRole("button", { name: "Archive 1" })).toBeTruthy();
  });

  it("a page change during the matching read drops the action", async () => {
    let openGate: () => void = () => {};
    answerMatchingPages(
      new Promise<void>((resolve) => {
        openGate = resolve;
      }),
    );
    const items = [
      makeItem({ prNumber: 1, title: "Alpha" }),
      makeItem({ prNumber: 2, title: "Beta" }),
    ];
    const { update } = await renderStageInRouter(
      <InboxList
        items={items}
        pageKey="a"
        pageSize={2}
        params={{}}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
        total={4}
      />,
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Select all on this page" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Select all 4 matching" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive 4" }));
    });

    update(
      <InboxList
        items={items}
        pageKey="b"
        pageSize={2}
        params={{}}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
        total={4}
      />,
    );
    await act(async () => {
      openGate();
    });

    await waitFor(() => {
      expect(
        screen.getByText(
          "The selection changed while the matching rows were being read. Nothing was done.",
        ),
      ).toBeTruthy();
    });
    const archived = fetchMock.mock.calls
      .map(([input]) => readRequestUrl(input ?? ""))
      .filter((url) => url.includes("/archive"));
    expect(archived).toHaveLength(0);
    expect(readSelectionStatus()).toBe("Nothing selected");
  });

  it("a new page key clears the selection; a same-key re-read keeps it", async () => {
    const items = [makeItem({ prNumber: 1, title: "Alpha" })];
    const { update } = await renderStageInRouter(
      <InboxList
        items={items}
        pageKey="a"
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    });
    expect(readSelectionStatus()).toBe("1 selected");

    update(
      <InboxList
        items={items.map((item) => ({ ...item }))}
        pageKey="a"
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    expect(readSelectionStatus()).toBe("1 selected");

    update(
      <InboxList
        items={items}
        pageKey="b"
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    await waitFor(() => {
      expect(readSelectionStatus()).toBe("Nothing selected");
    });
  });

  it("the ticks on the rows that went come off before the re-read lands", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(
      new Promise(() => {}),
    );
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "Alpha", viewerCanDelete: true }),
          makeItem({ prNumber: 2, title: "Beta", viewerCanDelete: true }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
      queryClient,
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Select all on this page" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    });
    const dialog = screen.getByRole("dialog");

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });

    await waitFor(() => {
      expect(readSelectionStatus()).toBe("Nothing selected");
    });
    expect(screen.queryByRole("button", { name: "Delete 2" })).toBeNull();
    expect(readRows().map((row) => row.getAttribute("data-selected"))).toEqual([
      "false",
      "false",
    ]);
  });

  it("a row archived from its menu loses its tick before the re-read lands", async () => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    vi.spyOn(queryClient, "invalidateQueries").mockReturnValue(
      new Promise(() => {}),
    );
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "Alpha" }),
          makeItem({ prNumber: 2, title: "Beta" }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
      queryClient,
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Select all on this page" }),
      );
    });
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "More actions" })[0]!,
      );
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    });

    await waitFor(() => {
      expect(readSelectionStatus()).toBe("1 selected");
    });
    expect(readRows().map((row) => row.getAttribute("data-selected"))).toEqual([
      "false",
      "true",
    ]);
  });

  it("a bulk delete unticks only the rows that went", async () => {
    fetchMock.mockImplementation(async (input) => {
      const url = readRequestUrl(input);
      const status = url.endsWith("/pulls/2") ? 500 : 200;
      return new Response(status === 200 ? '{"ok":true}' : "{}", { status });
    });
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "Alpha", viewerCanDelete: true }),
          makeItem({ prNumber: 2, title: "Beta", viewerCanDelete: true }),
          makeItem({ prNumber: 3, title: "Gamma" }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    await act(async () => {
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Select all on this page" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete 2" }));
    });
    const dialog = screen.getByRole("dialog");

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
    });

    await waitFor(() => {
      expect(readSelectionStatus()).toBe("2 selected");
    });
    expect(readRows().map((row) => row.getAttribute("data-selected"))).toEqual([
      "false",
      "true",
      "true",
    ]);
  });

  it("keys inside an open menu never move the cursor", async () => {
    await renderInRouter(
      <InboxList
        items={[makeItem({ prNumber: 1 }), makeItem({ prNumber: 2 })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    await act(async () => {
      fireEvent.click(
        screen.getAllByRole("button", { name: "More actions" })[0]!,
      );
    });
    const menu = screen.getByRole("menu");

    fireEvent.keyDown(menu, { key: "j" });
    fireEvent.keyDown(menu, { key: "ArrowDown" });

    expect(
      readRows().every((row) => row.getAttribute("data-cursor") === "false"),
    ).toBe(true);
  });

  it("shows the generation state while a brief is on its way or failed", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({
            prNumber: 1,
            generation: {
              status: "pending",
              updatedAt: "2026-09-20T10:00:00Z",
            },
          }),
          makeItem({
            prNumber: 2,
            generation: { status: "failed", updatedAt: "2026-09-20T10:00:00Z" },
          }),
          makeItem({
            prNumber: 3,
            generation: {
              status: "running",
              updatedAt: "2026-09-20T10:00:00Z",
            },
          }),
          makeItem({
            prNumber: 4,
            generation: { status: "capped", updatedAt: "2026-09-20T10:00:00Z" },
          }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    const rows = readRows();
    expect(within(rows[0]!).getByText("Queued")).toBeTruthy();
    expect(within(rows[1]!).getByText("Failed")).toBeTruthy();
    expect(within(rows[2]!).getByText("Generating")).toBeTruthy();
    expect(within(rows[3]!).getByText("Capped")).toBeTruthy();
  });
});
