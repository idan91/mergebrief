// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { InboxLayouts, InboxReviewStates, InboxSorts } from "types/inbox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderInRouter } from "../../../../test/router";
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
        items={[makeItem({ source: "url", viewerIsAuthor: true })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Delete" }));
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { level: 2 }),
      );
      expect(screen.getByRole("status").textContent).toBe("Deleted");
    });
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
