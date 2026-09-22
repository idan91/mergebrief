// @vitest-environment jsdom
import { cleanup, screen, within } from "@testing-library/react";
import { InboxReviewStates, InboxSorts } from "types/inbox";
import { afterEach, describe, expect, it } from "vitest";

import { renderInRouter } from "../../../../test/router";
import type { InboxItem } from "../../types";
import { InboxList } from "./InboxList";

afterEach(cleanup);

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
      />,
    );

    const rows = readRows();
    expect(rows.map((row) => within(row).getByText(/#\d/).textContent)).toEqual(
      ["#2", "#4", "#1", "#3"],
    );
    expect(screen.getByText("Nothing new below")).toBeTruthy();
    expect(rows[0]?.getAttribute("data-needs-you")).toBe("true");
    expect(rows[2]?.getAttribute("data-needs-you")).toBe("false");
  });

  it("shows no fold line when every row sits on one side", async () => {
    await renderInRouter(
      <InboxList
        items={[makeItem({ prNumber: 1 }), makeItem({ prNumber: 2 })]}
        sort={InboxSorts.UPDATED}
      />,
    );

    expect(screen.queryByText("Nothing new below")).toBeNull();
  });

  it("each row is one link to the brief, named by its title", async () => {
    await renderInRouter(
      <InboxList
        items={[makeItem({ title: "Rename `balance_minor` everywhere" })]}
        sort={InboxSorts.UPDATED}
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
      />,
    );

    const row = readRows()[0]!;
    expect(within(row).getByText("In progress")).toBeTruthy();
    expect(within(row).getByText("Added from a URL")).toBeTruthy();
    expect(within(row).getByText("Place in a stack: 2 of 4")).toBeTruthy();
    expect(
      within(row).getByText("GitHub no longer shows this pull request to you"),
    ).toBeTruthy();
    expect(row.getAttribute("data-unreachable")).toBe("true");
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
      />,
    );

    const rows = readRows();
    expect(within(rows[0]!).getByText("Queued")).toBeTruthy();
    expect(within(rows[1]!).getByText("Failed")).toBeTruthy();
    expect(within(rows[2]!).getByText("Generating")).toBeTruthy();
    expect(within(rows[3]!).getByText("Capped")).toBeTruthy();
  });
});
