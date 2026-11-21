// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { useState, type ReactNode } from "react";
import { InboxLayouts, InboxReviewStates, InboxSorts } from "types/inbox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NAVIGATION_NOTICE_DELAY } from "@web/components/NavigationProgress/consts";
import {
  TOAST_ACTION_VISIBLE_MS,
  TOAST_VISIBLE_MS,
} from "@web/components/Toast/consts";
import { omitFields } from "@web/test/fields";
import { renderInRouter, renderStageInRouter } from "../../../../test/router";
import type { InboxItem } from "../../types";
import { ROW_LINK_ATTRIBUTE } from "./consts";
import { InboxList } from ".";

const fetchMock = vi.fn<typeof fetch>();

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
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
    viewerCanPush: false,
    reviewState: InboxReviewStates.NEW,
    behind: false,
    unreachable: false,
    generation: { status: "succeeded", updatedAt: "2026-09-20T10:00:00Z" },
    latestBriefAt: "2026-09-20T10:00:00Z",
    githubUpdatedAt: "2026-09-20T09:00:00Z",
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

const RESTORE_FAILED = "Unarchived 0 of 2; 2 failed";
const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const ROW_STYLESHEET = readFileSync(
  join(TEST_DIR, "InboxRow/InboxRow.module.scss"),
  "utf8",
);

/** The toast's shown line, with any spoken hint after it. */
function readToastLine(): string | null {
  const [line] = within(screen.getByTestId("inbox-toast")).getAllByRole(
    "status",
  );
  return line?.textContent ?? null;
}

/** The toast's spoken-only line, where an older run's outcome lands. */
function readToastAside(): string | null {
  const regions = within(screen.getByTestId("inbox-toast")).getAllByRole(
    "status",
  );
  return regions[1]?.textContent ?? null;
}

function readUnarchivedUrls(): string[] {
  return fetchMock.mock.calls
    .map(([input]) => readRequestUrl(input ?? ""))
    .filter((url) => url.includes("/unarchive"));
}

/**
 * Archives Alpha and Gamma, then Beta from its menu while their restore
 * runs; the restore fails once Beta's line and Undo show. Answers Beta's Undo.
 */
async function failRestoreUnderNewerUndo(): Promise<HTMLElement> {
  answerMatchingPages();
  await renderInRouter(
    <InboxList
      items={[
        makeItem({ prNumber: 1, title: "Alpha" }),
        makeItem({ prNumber: 2, title: "Beta" }),
        makeItem({ prNumber: 3, title: "Gamma" }),
      ]}
      pageSize={3}
      params={{}}
      sort={InboxSorts.UPDATED}
      layout={InboxLayouts.FOLDED}
      total={3}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Gamma" }));
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Archive 2" }));
  });
  await screen.findByText("Archived 2");
  const undoBulk = screen.getByRole("button", { name: "Undo" });

  let openBeta: () => void = () => {};
  const betaGate = new Promise<void>((resolve) => {
    openBeta = resolve;
  });
  let openRestore: () => void = () => {};
  const restoreGate = new Promise<void>((resolve) => {
    openRestore = resolve;
  });
  fetchMock.mockImplementation(async (input) => {
    const path = new URL(readRequestUrl(input), "http://x").pathname;
    if (path.endsWith("/pulls/2/archive")) {
      await betaGate;
    }
    if (path.endsWith("/unarchive")) {
      await restoreGate;
      return new Response('{"code":"internal-error"}', { status: 500 });
    }
    return new Response('{"ok":true}', { status: 200 });
  });
  const [, betaMenu] = screen.getAllByRole("button", {
    name: "More actions",
  });
  await act(async () => {
    fireEvent.click(betaMenu as HTMLElement);
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
  });
  await act(async () => {
    fireEvent.click(undoBulk);
  });
  await act(async () => {
    openBeta();
  });
  await screen.findByText("Archived; it comes back when a new brief lands");
  const undoBeta = screen.getByRole("button", { name: "Undo" });

  await act(async () => {
    openRestore();
  });
  await waitFor(() => {
    expect(readToastAside()).toBe(RESTORE_FAILED);
  });
  return undoBeta;
}

/** The list at "/", beside a brief route whose loader waits on `gate`. */
async function renderBesideSlowBrief(tree: ReactNode, gate: Promise<void>) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const rootRoute = createRootRoute();
  const home = createRoute({
    getParentRoute: () => rootRoute,
    path: "/",
    component: () => (
      <QueryClientProvider client={queryClient}>{tree}</QueryClientProvider>
    ),
  });
  const brief = createRoute({
    getParentRoute: () => rootRoute,
    path: "/repos/$repoId/pulls/$prNumber",
    loader: () => gate,
    component: () => null,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([home, brief]),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  return router;
}

function readOpeningRows(): (string | null)[] {
  return readRows().map((row) => row.getAttribute("data-opening"));
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

async function selectWholePage(): Promise<void> {
  await act(async () => {
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Select all on this page" }),
    );
  });
}

/** An InboxList whose rows a test swaps the way a poll re-reads them, beside a field outside it. */
async function renderReReadHarness(
  initial: InboxItem[],
): Promise<{ setItems?: (items: InboxItem[]) => void }> {
  const host: { setItems?: (items: InboxItem[]) => void } = {};
  function ReReadHarness() {
    const [items, setItems] = useState(initial);
    host.setItems = setItems;
    return (
      <>
        <input aria-label="Outside" />
        <InboxList
          items={items}
          layout={InboxLayouts.FOLDED}
          sort={InboxSorts.UPDATED}
        />
      </>
    );
  }
  await renderInRouter(<ReReadHarness />);
  return host;
}

/**
 * Models the browser's focus fixup on a keyed move: jsdom keeps focus on a
 * node that `insertBefore` moves, a browser drops it to the body and fires
 * no focusout for it. React's commit then focuses the moved node again.
 */
function stubMoveDropsFocus() {
  const insertBefore = Node.prototype.insertBefore;
  return vi.spyOn(Node.prototype, "insertBefore").mockImplementation(function <
    Moved extends Node,
  >(this: Node, node: Moved, child: Node | null): Moved {
    const active = document.activeElement;
    const holdsFocus = active instanceof HTMLElement && node.contains(active);
    if (holdsFocus && node.isConnected) {
      window.addEventListener("focusout", stopEvent, {
        capture: true,
        once: true,
      });
      active.blur();
    }
    return insertBefore.call(this, node, child) as Moved;
  });
}

function stopEvent(event: Event): void {
  event.stopImmediatePropagation();
}

/**
 * Blurs to the body the way a browser does: the document keeps focus. jsdom
 * clears its focused element before focusout, so `hasFocus()` reads false
 * there, which the list takes for a window blur.
 */
function blurInsidePage(element: HTMLElement): void {
  const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(true);
  act(() => element.blur());
  hasFocus.mockRestore();
}

/** Opens the cursor row's menu, whose items render in a portal, and puts focus in it. */
async function openCursorRowMenu(): Promise<void> {
  const cursorRow = readRows().find(
    (row) => row.getAttribute("data-cursor") === "true",
  );
  if (cursorRow === undefined) {
    throw new Error("no cursor row");
  }
  await act(async () => {
    fireEvent.click(
      within(cursorRow).getByRole("button", { name: "More actions" }),
    );
  });
  const [item] = within(screen.getByRole("menu")).getAllByRole("menuitem");
  act(() => item?.focus());
  expect(cursorRow.contains(document.activeElement)).toBe(false);
}

/** Lets a focus handed over on the next frame land before the test reads it. */
async function waitForNextFrame(): Promise<void> {
  await act(async () => {
    await new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve());
    });
  });
}

describe("InboxList", () => {
  it("splits at the fold and keeps the server order on each side", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, reviewState: InboxReviewStates.REVIEWED }),
          makeItem({ prNumber: 2, reviewState: InboxReviewStates.UPDATED }),
          omitFields(
            makeItem({ prNumber: 3, viewerIsAuthor: true }),
            "reviewState",
          ),
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
          omitFields(
            makeItem({ prNumber: 3, viewerIsAuthor: true }),
            "reviewState",
          ),
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

  it("shows the author on rows the viewer did not open", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, authorLogin: "mira-k" }),
          makeItem({
            prNumber: 2,
            authorLogin: "octocat",
            viewerIsAuthor: true,
          }),
          makeItem({ prNumber: 3 }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.MIXED}
      />,
    );

    const [others, own, unknown] = readRows();
    expect(within(others!).getByTestId("author-chip").textContent).toBe(
      "mira-k",
    );
    expect(within(own!).queryByTestId("author-chip")).toBeNull();
    expect(within(unknown!).queryByTestId("author-chip")).toBeNull();
  });

  it("names the author in the row link after its state", async () => {
    await renderInRouter(
      <InboxList
        items={[makeItem({ prNumber: 1, authorLogin: "mira-k" })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    const link = screen.getByRole("link", { name: /Open\. By mira-k\./ });
    expect(
      within(link).getByTestId("author-chip").closest("[aria-hidden]"),
    ).not.toBeNull();
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

  it("renders a row whose vocabulary values it predates with no status", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({
            state: "unknown",
            source: "unknown",
            generation: {
              status: "unknown",
              updatedAt: "2026-09-20T10:00:00Z",
            },
            title: "Retry deliveries",
          }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    const row = readRows()[0]!;
    expect(
      within(row).getByRole("link", { name: /^New\. Retry deliveries/ }),
    ).toBeTruthy();
    expect(row.querySelector("[data-status]")).toBeNull();
    expect(row.querySelector("[data-generation]")).toBeNull();
  });

  it("names the mark, the source and the chips for assistive technology", async () => {
    await renderInRouter(
      <InboxList
        items={[
          omitFields(
            makeItem({
              source: "url",
              reviewState: InboxReviewStates.IN_PROGRESS,
              stack: { index: 2, size: 4 },
              unreachable: true,
            }),
            "installationId",
          ),
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
          omitFields(
            makeItem({
              source: "url",
              draft: true,
              generation: {
                status: "pending",
                updatedAt: "2026-09-20T10:00:00Z",
              },
              title: "Retry deliveries",
            }),
            "installationId",
          ),
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

  it("the row link's text keeps the age, the reason and its count apart", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({
            generation: {
              status: "held",
              updatedAt: "2026-09-20T10:00:00Z",
              unmetConditions: [
                { kind: "labels", setBy: "repo", labels: ["needs-brief"] },
                { kind: "never", setBy: "repo" },
              ],
            },
          }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    const reason = screen.getByTestId("inbox-row-reason");
    const link = reason.closest("a");
    const text = link?.textContent ?? "";
    expect(text).toMatch(/\S Needs the label needs-brief 1 more$/);
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
    const chip = screen.getByText("New commits").parentElement;
    expect(chip?.getAttribute("data-tone")).toBe("changed");
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

  it("j carries keyboard focus onto the row it lands on", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "First" }),
          makeItem({ prNumber: 2, title: "Second" }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });

    const secondLink = screen.getByRole("link", { name: /Second/ });
    expect(document.activeElement).toBe(secondLink);
    expect(secondLink.hasAttribute(ROW_LINK_ATTRIBUTE)).toBe(true);

    fireEvent.keyDown(window, { key: "k" });

    const firstLink = screen.getByRole("link", { name: /First/ });
    expect(document.activeElement).toBe(firstLink);
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

  it("a re-read moves the cursor with its row and never scrolls", async () => {
    const first = makeItem({ prNumber: 1, title: "First" });
    const second = makeItem({ prNumber: 2, title: "Second" });
    const third = makeItem({ prNumber: 3, title: "Third" });
    const newcomer = makeItem({ prNumber: 9, title: "Newcomer" });
    const host: { setItems?: (items: InboxItem[]) => void } = {};
    function ReReadHarness() {
      const [items, setItems] = useState([first, second, third]);
      host.setItems = setItems;
      return (
        <InboxList
          items={items}
          layout={InboxLayouts.FOLDED}
          sort={InboxSorts.UPDATED}
        />
      );
    }
    function readCursorRowText(): string | null {
      const row = readRows().find(
        (candidate) => candidate.getAttribute("data-cursor") === "true",
      );
      return row?.textContent ?? null;
    }
    await renderInRouter(<ReReadHarness />);
    fireEvent.keyDown(window, { key: "j" });
    fireEvent.keyDown(window, { key: "j" });
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");

    act(() => host.setItems?.([newcomer, first, second, third]));
    expect(readCursorRowText()).toContain("Second");
    act(() => host.setItems?.([newcomer, first, third]));
    expect(readCursorRowText()).toContain("Third");

    expect(scrollIntoView).not.toHaveBeenCalled();
    scrollIntoView.mockRestore();
  });

  it("a re-read across the fold keeps focus on the cursor row's link", async () => {
    const first = makeItem({ prNumber: 1, title: "First" });
    const second = makeItem({ prNumber: 2, title: "Second" });
    const host = await renderReReadHarness([first, second]);
    fireEvent.keyDown(window, { key: "j" });
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");

    act(() =>
      host.setItems?.([
        makeItem({
          prNumber: 1,
          title: "First",
          reviewState: InboxReviewStates.REVIEWED,
        }),
        second,
      ]),
    );

    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: /First/ }),
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
    scrollIntoView.mockRestore();
  });

  it("a re-read taking the focused cursor row focuses the heading in place", async () => {
    const first = makeItem({ prNumber: 1, title: "First" });
    const second = makeItem({ prNumber: 2, title: "Second" });
    const host = await renderReReadHarness([first, second]);
    fireEvent.keyDown(window, { key: "j" });
    const heading = screen.getByRole("heading", { name: "Briefs" });
    const focus = vi.spyOn(heading, "focus");

    act(() => host.setItems?.([second]));

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Briefs" }),
      );
    });
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
  });

  it("a re-read taking the row whose menu holds focus focuses the heading", async () => {
    const first = makeItem({ prNumber: 1, title: "First" });
    const second = makeItem({ prNumber: 2, title: "Second" });
    const host = await renderReReadHarness([first, second]);
    fireEvent.keyDown(window, { key: "j" });
    await openCursorRowMenu();

    act(() => host.setItems?.([second]));

    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByRole("heading", { name: "Briefs" }),
      );
    });
  });

  it("a re-read across the fold moves focus from the row's menu to its link", async () => {
    const first = makeItem({ prNumber: 1, title: "First" });
    const second = makeItem({ prNumber: 2, title: "Second" });
    const host = await renderReReadHarness([first, second]);
    fireEvent.keyDown(window, { key: "j" });
    await openCursorRowMenu();

    act(() =>
      host.setItems?.([
        makeItem({
          prNumber: 1,
          title: "First",
          reviewState: InboxReviewStates.REVIEWED,
        }),
        second,
      ]),
    );

    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: /First/ }),
    );
  });

  it("a re-read leaves focus that sat outside the cursor row alone", async () => {
    const first = makeItem({ prNumber: 1, title: "First" });
    const second = makeItem({ prNumber: 2, title: "Second" });
    const host = await renderReReadHarness([first, second]);
    fireEvent.keyDown(window, { key: "j" });
    const outside = screen.getByRole("textbox", { name: "Outside" });
    outside.focus();

    act(() => host.setItems?.([second]));
    await act(async () => {
      await new Promise<void>((resolve) => {
        window.requestAnimationFrame(() => resolve());
      });
    });

    expect(document.activeElement).toBe(outside);
  });

  it("a re-read that reorders one list keeps focus on the cursor row", async () => {
    const first = makeItem({ prNumber: 1, title: "First" });
    const second = makeItem({ prNumber: 2, title: "Second" });
    const third = makeItem({ prNumber: 3, title: "Third" });
    const host = await renderReReadHarness([first, second, third]);
    fireEvent.keyDown(window, { key: "j" });
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: /First/ }),
    );
    const move = stubMoveDropsFocus();
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");

    act(() => host.setItems?.([second, first, third]));

    expect(move).toHaveBeenCalled();
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: /First/ }),
    );
    expect(scrollIntoView).not.toHaveBeenCalled();
    scrollIntoView.mockRestore();
    move.mockRestore();
  });

  it("a window blur keeps the cursor row's focus through a later re-read", async () => {
    const first = makeItem({ prNumber: 1, title: "First" });
    const second = makeItem({ prNumber: 2, title: "Second" });
    const host = await renderReReadHarness([first, second]);
    fireEvent.keyDown(window, { key: "j" });
    const hasFocus = vi.spyOn(document, "hasFocus").mockReturnValue(false);
    fireEvent.focusOut(screen.getByRole("link", { name: /First/ }));
    hasFocus.mockRestore();

    act(() =>
      host.setItems?.([
        makeItem({
          prNumber: 1,
          title: "First",
          reviewState: InboxReviewStates.REVIEWED,
        }),
        second,
      ]),
    );

    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: /First/ }),
    );
  });

  it("the cursor follows focus into a row, so j steps from there", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "First" }),
          makeItem({ prNumber: 2, title: "Second" }),
          makeItem({ prNumber: 3, title: "Third" }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    const secondLink = screen.getByRole("link", { name: /Second/ });
    act(() => secondLink.focus());

    expect(readRows()[1]?.getAttribute("data-cursor")).toBe("true");
    fireEvent.keyDown(secondLink, { key: "j" });

    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: /Third/ }),
    );
  });

  it("focus on a row's checkbox moves the cursor without refocus or scroll", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "First" }),
          makeItem({ prNumber: 2, title: "Second" }),
          makeItem({ prNumber: 3, title: "Third" }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    const scrollIntoView = vi.spyOn(Element.prototype, "scrollIntoView");
    const box = screen.getByRole("checkbox", { name: "Select Second" });

    act(() => box.focus());

    expect(readRows()[1]?.getAttribute("data-cursor")).toBe("true");
    expect(document.activeElement).toBe(box);
    expect(scrollIntoView).not.toHaveBeenCalled();
    scrollIntoView.mockRestore();
  });

  it("focus blurred off the cursor row stays put when that row leaves", async () => {
    const first = makeItem({ prNumber: 1, title: "First" });
    const second = makeItem({ prNumber: 2, title: "Second" });
    const host = await renderReReadHarness([first, second]);
    fireEvent.keyDown(window, { key: "j" });
    blurInsidePage(screen.getByRole("link", { name: /First/ }));
    const focus = vi.spyOn(
      screen.getByRole("heading", { name: "Briefs" }),
      "focus",
    );

    act(() => host.setItems?.([second]));
    await waitForNextFrame();

    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("focus blurred off the cursor row stays put when it crosses the fold", async () => {
    const first = makeItem({ prNumber: 1, title: "First" });
    const second = makeItem({ prNumber: 2, title: "Second" });
    const host = await renderReReadHarness([first, second]);
    fireEvent.keyDown(window, { key: "j" });
    blurInsidePage(screen.getByRole("link", { name: /First/ }));
    const focus = vi.spyOn(
      screen.getByRole("heading", { name: "Briefs" }),
      "focus",
    );

    act(() =>
      host.setItems?.([
        makeItem({
          prNumber: 1,
          title: "First",
          reviewState: InboxReviewStates.REVIEWED,
        }),
        second,
      ]),
    );
    await waitForNextFrame();

    expect(focus).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it("the arrows belong to the page while focus is outside the list", async () => {
    await renderInRouter(
      <InboxList
        items={[makeItem({ prNumber: 1 }), makeItem({ prNumber: 2 })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    const notPrevented = fireEvent.keyDown(document.body, { key: "ArrowDown" });

    expect(notPrevented).toBe(true);
    expect(readRows().map((row) => row.getAttribute("data-cursor"))).toEqual([
      "false",
      "false",
    ]);
  });

  it("the arrows step the cursor from a focused row link", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "First" }),
          makeItem({ prNumber: 2, title: "Second" }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    const firstLink = screen.getByRole("link", { name: /First/ });
    act(() => firstLink.focus());

    const notPrevented = fireEvent.keyDown(firstLink, { key: "ArrowDown" });

    expect(notPrevented).toBe(false);
    expect(document.activeElement).toBe(
      screen.getByRole("link", { name: /Second/ }),
    );
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
            viewerCanPush: false,
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

  it("purging a repository's attachment branch asks for its name first", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );
    await renderInRouter(
      <InboxList
        items={[makeItem({ viewerCanDelete: true })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    await openRowMenu();

    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Delete attachment branch" }),
      );
    });
    const dialog = screen.getByRole("dialog", { name: /attachment branch/ });
    await waitFor(() => {
      expect(document.activeElement).toBe(
        within(dialog).getByRole("button", { name: "Cancel" }),
      );
    });
    const confirm = within(dialog).getByRole("button", {
      name: "Delete branch",
    });
    expect(confirm.getAttribute("aria-disabled")).toBe("true");
    fireEvent.change(
      within(dialog).getByLabelText("Type acme/payments to confirm"),
      { target: { value: "acme/payments" } },
    );
    await act(async () => {
      fireEvent.click(confirm);
    });

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(readRequestUrl(url ?? "")).toMatch(
      /\/api\/repos\/424242\/attachments$/,
    );
    expect(init?.method).toBe("DELETE");
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: /attachment branch/ }),
      ).toBeNull();
      expect(screen.getByText("Attachment branch deleted")).toBeTruthy();
    });
    expect(readRows()).toHaveLength(1);
  });

  it("cancelling the purge modal returns focus to the row's menu trigger", async () => {
    await renderInRouter(
      <InboxList
        items={[makeItem({ viewerCanDelete: true })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    const trigger = await openRowMenu();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("menuitem", { name: "Delete attachment branch" }),
      );
    });
    const dialog = screen.getByRole("dialog", { name: /attachment branch/ });

    await act(async () => {
      fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(trigger);
    });
    expect(readRows()).toHaveLength(1);
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
    expect(
      within(screen.getByTestId("selection-header")).getByText("1 brief"),
    ).toBeTruthy();
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

  it("unticking the page checkbox leaves the focus on it", async () => {
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
    const page = screen.getByRole("checkbox", {
      name: "Select all on this page",
    });
    page.focus();

    await selectWholePage();
    expect(readSelectionStatus()).toBe("2 selected");
    await selectWholePage();
    await act(async () => {
      await new Promise((resolve) => {
        window.requestAnimationFrame(resolve);
      });
    });

    expect(document.activeElement).toBe(page);
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
    await selectWholePage();
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
    await selectWholePage();
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
      expect(
        screen.getByText("Archived; it comes back when a new brief lands"),
      ).toBeTruthy();
    });
    const archived = fetchMock.mock.calls
      .map(([input]) => readRequestUrl(input ?? ""))
      .filter((url) => url.includes("/archive"));
    expect(archived).toHaveLength(1);
    expect(archived[0]).toContain("/pulls/1/");
  });

  it("Undo after an archive restores the same row and says so", async () => {
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
        total={2}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive 1" }));
    });

    const undo = await screen.findByRole("button", { name: "Undo" });
    await act(async () => {
      fireEvent.click(undo);
    });

    await screen.findByText("Back in your Inbox");
    const restored = fetchMock.mock.calls
      .map(([input]) => readRequestUrl(input ?? ""))
      .filter((url) => url.includes("/unarchive"));
    expect(restored).toHaveLength(1);
    expect(restored[0]).toContain("/pulls/1/");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("hands focus to the heading when a focused Undo leaves", async () => {
    answerMatchingPages();
    await renderInRouter(
      <InboxList
        items={[makeItem({ prNumber: 1, title: "Alpha" })]}
        pageSize={1}
        params={{}}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
        total={1}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive 1" }));
    });
    const undo = await screen.findByRole("button", { name: "Undo" });
    const heading = screen.getByRole("heading", { level: 2, name: "Briefs" });
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
    let finishRestore = (_response: Response): void => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishRestore = resolve;
        }),
    );
    await act(async () => {
      fireEvent.click(undo);
    });

    act(() => {
      screen.getByRole("button", { name: "Undo" }).focus();
    });
    await act(async () => {
      finishRestore(new Response('{"ok":true}', { status: 200 }));
    });

    await screen.findByText("Back in your Inbox");
    await waitFor(() => {
      expect(document.activeElement).toBe(heading);
    });
  });

  it("offers Undo again over a restore that failed", async () => {
    answerMatchingPages();
    await renderInRouter(
      <InboxList
        items={[makeItem({ prNumber: 1, title: "Alpha" })]}
        pageSize={1}
        params={{}}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
        total={1}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive 1" }));
    });
    const undo = await screen.findByRole("button", { name: "Undo" });
    fetchMock.mockImplementationOnce(() =>
      Promise.resolve(Response.json({}, { status: 500 })),
    );

    await act(async () => {
      fireEvent.click(undo);
    });

    await screen.findByText("Unarchive failed; the row is still archived");
    const again = screen.getByRole("button", { name: "Undo" });
    await act(async () => {
      fireEvent.click(again);
    });
    await screen.findByText("Back in your Inbox");
    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("holds every Archive while a restore is pending", async () => {
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
        total={2}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive 1" }));
    });
    const undo = await screen.findByRole("button", { name: "Undo" });
    fetchMock.mockImplementationOnce(() => new Promise<Response>(() => {}));
    await act(async () => {
      fireEvent.click(undo);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Beta" }));
    });

    expect(
      screen
        .getByRole("button", { name: "Archive 1" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    const [menu] = screen.getAllByRole("button", { name: "More actions" });
    await act(async () => {
      fireEvent.click(menu as HTMLElement);
    });
    expect(
      screen
        .getByRole("menuitem", { name: "Archive" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("holds Undo while another restore is pending", async () => {
    answerMatchingPages();
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "Alpha" }),
          makeItem({ prNumber: 2, title: "Beta" }),
          makeItem({ prNumber: 3, title: "Gamma" }),
        ]}
        pageSize={3}
        params={{}}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
        total={3}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Gamma" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive 2" }));
    });
    await screen.findByText("Archived 2");
    const undoBulk = screen.getByRole("button", { name: "Undo" });

    let openBeta: () => void = () => {};
    const betaGate = new Promise<void>((resolve) => {
      openBeta = resolve;
    });
    let openRestore: () => void = () => {};
    const restoreGate = new Promise<void>((resolve) => {
      openRestore = resolve;
    });
    fetchMock.mockImplementation(async (input) => {
      const path = new URL(readRequestUrl(input), "http://x").pathname;
      if (path.endsWith("/pulls/2/archive")) {
        await betaGate;
      }
      if (path.endsWith("/unarchive")) {
        await restoreGate;
      }
      return new Response('{"ok":true}', { status: 200 });
    });
    const [, betaMenu] = screen.getAllByRole("button", {
      name: "More actions",
    });
    await act(async () => {
      fireEvent.click(betaMenu as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: "Archive" }));
    });
    await act(async () => {
      fireEvent.click(undoBulk);
    });
    await act(async () => {
      openBeta();
    });

    await screen.findByText("Archived; it comes back when a new brief lands");
    const undoBeta = screen.getByRole("button", { name: "Undo" });
    expect(undoBeta.getAttribute("aria-disabled")).toBe("true");
    await act(async () => {
      undoBeta.focus();
      fireEvent.click(undoBeta);
    });
    expect(document.activeElement).toBe(undoBeta);

    await act(async () => {
      openRestore();
    });
    await waitFor(() => {
      expect(readToastAside()).toBe("Unarchived 2");
    });
    const restored = fetchMock.mock.calls
      .map(([input]) => readRequestUrl(input ?? ""))
      .filter((url) => url.includes("/unarchive"));
    expect(restored).toHaveLength(2);
    expect(restored.some((url) => url.includes("/pulls/2/"))).toBe(false);

    expect(
      screen.getByText("Archived; it comes back when a new brief lands"),
    ).toBeTruthy();
    expect(undoBeta.isConnected).toBe(true);
    expect(undoBeta.getAttribute("aria-disabled")).toBeNull();
    expect(document.activeElement).toBe(undoBeta);
    await act(async () => {
      fireEvent.click(undoBeta);
    });
    await waitFor(() => {
      expect(
        readUnarchivedUrls().some((url) => url.includes("/pulls/2/")),
      ).toBe(true);
    });
  });

  it("keeps a newer Undo and shows a failed restore once it leaves", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    const undoBeta = await failRestoreUnderNewerUndo();

    expect(readToastLine()).toContain(
      "Archived; it comes back when a new brief lands",
    );
    expect(undoBeta.isConnected).toBe(true);
    expect(undoBeta.getAttribute("aria-disabled")).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(TOAST_ACTION_VISIBLE_MS);
    });
    await waitFor(() => {
      expect(readToastLine()).toContain(RESTORE_FAILED);
    });
    expect(screen.getByTestId("inbox-toast").getAttribute("data-state")).toBe(
      "visible",
    );
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('{"ok":true}', { status: 200 })),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Undo" }));
    });
    await waitFor(() => {
      expect(readToastLine()).toBe("Unarchived 2");
    });
    const alphaRestores = readUnarchivedUrls().filter((url) =>
      url.includes("/pulls/1/"),
    );
    expect(alphaRestores).toHaveLength(2);
  });

  it("keeps a waiting retry back until a slow newer restore lands", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout"],
      shouldAdvanceTime: true,
    });
    const undoBeta = await failRestoreUnderNewerUndo();
    let openBetaRestore: () => void = () => {};
    const betaRestoreGate = new Promise<void>((resolve) => {
      openBetaRestore = resolve;
    });
    fetchMock.mockImplementation(async () => {
      await betaRestoreGate;
      return new Response('{"ok":true}', { status: 200 });
    });

    await act(async () => {
      fireEvent.click(undoBeta);
    });
    await act(async () => {
      vi.advanceTimersByTime(TOAST_ACTION_VISIBLE_MS * 2);
    });
    expect(readToastLine()).toContain(
      "Archived; it comes back when a new brief lands",
    );

    await act(async () => {
      openBetaRestore();
    });
    await waitFor(() => {
      expect(readToastLine()).toBe("Back in your Inbox");
    });
    await act(async () => {
      vi.advanceTimersByTime(TOAST_VISIBLE_MS);
    });
    await waitFor(() => {
      expect(readToastLine()).toContain(RESTORE_FAILED);
    });
    const retry = screen.getByRole("button", { name: "Undo" });
    expect(retry.getAttribute("aria-disabled")).toBeNull();
  });

  it("marks only the row whose brief is opening", async () => {
    answerMatchingPages();
    let openBrief: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openBrief = resolve;
    });
    await renderBesideSlowBrief(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "Alpha" }),
          makeItem({ prNumber: 2, title: "Beta" }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
      gate,
    );
    expect(readOpeningRows()).toEqual([null, null]);

    const betaLink = readRows()[1]?.querySelector("a");
    act(() => {
      betaLink?.click();
    });

    await waitFor(() => {
      expect(readOpeningRows()).toEqual([null, ""]);
    });
    await act(async () => {
      openBrief();
      await gate;
    });
  });

  it("marks the row when its brief opens at a revision", async () => {
    answerMatchingPages();
    let openBrief: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      openBrief = resolve;
    });
    const router = await renderBesideSlowBrief(
      <InboxList
        items={[makeItem({ prNumber: 1, title: "Alpha" })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
      gate,
    );

    act(() => {
      void router.navigate({
        to: "/repos/$repoId/pulls/$prNumber",
        params: { repoId: "424242", prNumber: "1" },
        search: { rev: 2 },
      });
    });

    await waitFor(() => {
      expect(readOpeningRows()).toEqual([""]);
    });
    await act(async () => {
      openBrief();
      await gate;
    });
  });

  it("waits out the navigation notice delay before the opening edge", async () => {
    answerMatchingPages();
    await renderInRouter(
      <InboxList
        items={[makeItem({ prNumber: 1, title: "Alpha" })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    const [row] = readRows();
    expect(row?.style.getPropertyValue("--notice-delay")).toBe(
      NAVIGATION_NOTICE_DELAY,
    );
    const openingRule = ROW_STYLESHEET.match(/&\[data-opening\] \{[^}]*\}/u);
    expect(openingRule?.[0]).toContain("var(--notice-delay)");
  });

  it("draws the opening edge in a neutral grey, never the accent", () => {
    const edge = ROW_STYLESHEET.match(/--row-opening-edge:[^;]*;/u);

    expect(edge?.[0]).toContain("var(--color-text-2)");
    expect(edge?.[0]).not.toContain("accent");
  });

  it("places Undo right after the heading and says it is there", async () => {
    answerMatchingPages();
    await renderInRouter(
      <InboxList
        items={[makeItem({ prNumber: 1, title: "Alpha" })]}
        pageSize={1}
        params={{}}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
        total={1}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Archive 1" }));
    });

    const undo = await screen.findByRole("button", { name: "Undo" });
    const heading = document.getElementById("inbox-heading");
    const toast = screen.getByTestId("inbox-toast");
    expect(heading?.nextElementSibling).toBe(toast);
    expect(toast.contains(undo)).toBe(true);
    const status = toast.querySelector("[role=status]");
    await waitFor(() => {
      expect(status?.textContent).toContain(
        "Undo comes right after the heading",
      );
    });
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
    await selectWholePage();
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

  it("a row delete is unavailable while all matching rows are read", async () => {
    let releasePageTwo: () => void = () => {};
    answerMatchingPages(
      new Promise<void>((resolve) => {
        releasePageTwo = resolve;
      }),
    );
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "Alpha", viewerCanDelete: true }),
          makeItem({ prNumber: 2, title: "Beta", viewerCanDelete: true }),
        ]}
        pageSize={2}
        params={{}}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
        total={4}
      />,
    );
    await selectWholePage();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Select all 4 matching" }),
      );
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Delete matching" }));
    });

    const [alphaMenu] = screen.getAllByRole("button", { name: "More actions" });
    await act(async () => {
      fireEvent.click(alphaMenu as HTMLElement);
    });
    const rowDelete = screen.getByRole("menuitem", { name: "Delete" });
    expect(rowDelete.getAttribute("aria-disabled")).toBe("true");
    const reasonId = rowDelete.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(reasonId)?.textContent).toBe(
      "Wait until every matching row is read",
    );
    await act(async () => {
      fireEvent.click(rowDelete);
    });
    const deleteModal = screen
      .getByRole("dialog", { hidden: true })
      .closest("[data-state]");
    expect(deleteModal?.getAttribute("data-state")).toBe("closed");

    await act(async () => {
      releasePageTwo();
    });
    await waitFor(() => {
      expect(
        screen.getByText("None of the 4 matching rows can be deleted"),
      ).toBeTruthy();
    });
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
    await selectWholePage();
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
    await selectWholePage();
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
    await selectWholePage();
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
    fetchMock.mockImplementation(
      async () => new Response(null, { status: 204 }),
    );
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
    await selectWholePage();
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
    await selectWholePage();
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
    await selectWholePage();
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

  it("shows every box and the bulk actions only once rows are selected", async () => {
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ title: "Alpha" }),
          makeItem({ title: "Beta", prNumber: 2 }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    const rows = readRows();
    const header = screen.getByTestId("selection-header");
    expect(rows[1]?.getAttribute("data-selecting")).toBe("false");
    expect(header.getAttribute("data-selecting")).toBe("false");
    expect(screen.queryByRole("button", { name: "Archive 1" })).toBeNull();

    await act(async () => {
      fireEvent.click(screen.getByRole("checkbox", { name: "Select Alpha" }));
    });

    expect(header.getAttribute("data-selecting")).toBe("true");
    expect(screen.getByRole("button", { name: "Archive 1" })).toBeTruthy();
    expect(readRows()[1]?.getAttribute("data-selecting")).toBe("true");
  });

  it("the Select button enters selecting and Clear leaves it", async () => {
    await renderInRouter(
      <InboxList
        items={[makeItem({ title: "Alpha" })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select" }));
    });
    expect(
      within(screen.getByTestId("selection-header")).getByText(
        "Nothing selected",
      ),
    ).toBeTruthy();
    expect(readRows()[0]?.getAttribute("data-selecting")).toBe("true");
    expect(document.activeElement).toBe(
      screen.getByRole("checkbox", { name: "Select all on this page" }),
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    });
    expect(
      screen.getByTestId("selection-header").getAttribute("data-selecting"),
    ).toBe("false");
    expect(readRows()[0]?.getAttribute("data-selecting")).toBe("false");
  });

  it.each([
    ["archive", "Archive", "Archived; it comes back when a new brief lands"],
    ["delete", "Delete", "Deleted"],
  ])("a row menu %s keeps select mode on", async (_action, item, outcome) => {
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    await renderInRouter(
      <InboxList
        items={[
          makeItem({ prNumber: 1, title: "Alpha" }),
          makeItem({ prNumber: 2, title: "Beta" }),
          makeItem({ prNumber: 3, title: "Gamma", viewerCanDelete: true }),
        ]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Select" }));
    });
    for (const title of ["Alpha", "Beta"]) {
      await act(async () => {
        fireEvent.click(
          screen.getByRole("checkbox", { name: `Select ${title}` }),
        );
      });
    }
    const gammaMenu = screen.getAllByRole("button", {
      name: "More actions",
    })[2];

    await act(async () => {
      fireEvent.click(gammaMenu as HTMLElement);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("menuitem", { name: item }));
    });
    const dialog = screen.queryByRole("dialog");
    if (dialog !== null) {
      await act(async () => {
        fireEvent.click(within(dialog).getByRole("button", { name: "Delete" }));
      });
    }
    await screen.findByText(outcome);
    for (const title of ["Alpha", "Beta"]) {
      await act(async () => {
        fireEvent.click(
          screen.getByRole("checkbox", { name: `Select ${title}` }),
        );
      });
    }

    expect(readSelectionStatus()).toBe("Nothing selected");
    expect(
      screen.getByTestId("selection-header").getAttribute("data-selecting"),
    ).toBe("true");
  });

  it("states how many briefs the page shows of the matching total", async () => {
    await renderInRouter(
      <InboxList
        items={[makeItem({ title: "Alpha" })]}
        sort={InboxSorts.UPDATED}
        layout={InboxLayouts.FOLDED}
        total={37}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 2, name: "Briefs" }),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("selection-header")).getByText(
        "Showing 1 of 37 briefs",
      ),
    ).toBeTruthy();
  });
});
