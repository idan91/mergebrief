// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  createMemoryHistory,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildLocalBriefDiffsQueryOptions,
  buildLocalBriefQueryOptions,
  buildLocalBriefsQueryOptions,
} from "../features/brief/queries";
import { buildViewerQueryOptions } from "../features/account/queries";
import { ViewerStates, type ViewerState } from "../features/account/types";
import {
  briefFixture,
  briefSummaryFixture,
  mountBriefView,
} from "@web/features/brief/test-utils";
import { routeTree } from "../routeTree.gen";
import { emptySessionPayload } from "../features/review/session";

const SIGNED_IN_VIEWER: ViewerState = {
  kind: ViewerStates.SIGNED_IN,
  login: "octocat",
  avatarUrl: "https://avatars.example/octocat.png",
  operator: false,
};

const BRIEF_ID = briefSummaryFixture.id;

/**
 * The same screen with a live session, rendered without the file route: the
 * route's brief is read-only (no session exists for a file), so the write
 * paths need a harness that has one.
 */
async function renderWritableScreen() {
  await mountBriefView({
    session: emptySessionPayload(),
  });
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { level: 1, name: briefFixture.pr.title }),
    ).toBeTruthy(),
  );
}

const LEAK_PATCH = [
  "diff --git a/src/leak.ts b/src/leak.ts",
  "--- a/src/leak.ts",
  "+++ b/src/leak.ts",
  "@@ -9,2 +9,6 @@",
  " const shared = read();",
  "+guardFromPatch(shared);",
  "+validate(shared);",
  "+audit(shared);",
  "+emit(shared);",
  " return shared;",
].join("\n");

async function renderBriefView(
  brief = briefFixture,
  patches: { file: string; patch: string }[] = [],
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(
    buildViewerQueryOptions().queryKey,
    SIGNED_IN_VIEWER,
  );
  queryClient.setQueryData(
    buildLocalBriefQueryOptions(BRIEF_ID).queryKey,
    brief,
  );
  queryClient.setQueryData(
    buildLocalBriefDiffsQueryOptions(BRIEF_ID).queryKey,
    patches,
  );
  queryClient.setQueryData(buildLocalBriefsQueryOptions().queryKey, [
    briefSummaryFixture,
  ]);

  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({ initialEntries: [`/briefs/${BRIEF_ID}`] }),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(
      screen.getByRole("heading", { level: 1, name: brief.pr.title }),
    ).toBeTruthy(),
  );
  return { queryClient };
}

/**
 * Characterization suite for the screen's critical couplings. Asserts
 * behaviour observable through the rendered screen, not store internals.
 */
function statText(label: string): string | null {
  const stat = screen.getByText(label).closest(".stat");
  return stat?.querySelector("b")?.textContent ?? null;
}

describe("brief screen characterization", () => {
  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it("renders the change-group story", async () => {
    await renderBriefView();
    expect(screen.getByText(briefFixture.changeGroups[0]!.title)).toBeTruthy();
  });

  it("slices each chunk's rows from the diffs sidecar on the client", async () => {
    await renderBriefView(briefFixture, [
      { file: "src/leak.ts", patch: LEAK_PATCH },
    ]);

    await waitFor(() =>
      expect(document.body.textContent).toContain("guardFromPatch(shared);"),
    );
  });

  it("enters focus mode with a visible active chunk", async () => {
    await renderBriefView();

    fireEvent.keyDown(window, { key: "z" });

    await waitFor(() =>
      expect(
        document.querySelector(
          '[data-testid="story-group"][data-active-group]',
        ),
      ).toBeTruthy(),
    );
    expect(document.querySelector("article[data-current]")).toBeTruthy();
  });

  it("shows the change-group context panel in focus mode and hides it", async () => {
    await renderBriefView();

    fireEvent.keyDown(window, { key: "z" });

    const panel = await screen.findByRole("complementary", {
      name: "Focused change-group context",
    });
    expect(panel.textContent).toContain(briefFixture.changeGroups[0]!.title);
    expect(panel.textContent).toContain(briefFixture.changeGroups[0]!.summary);
    expect(panel.textContent).toContain("Active chunk risks");
    expect(panel.textContent).toContain("No tests");

    fireEvent.click(screen.getByRole("button", { name: "Hide context (S)" }));

    expect(panel.dataset["state"]).toBe("closed");
    expect(
      screen.getByRole("button", { name: "Group 1: show context (S)" }),
    ).toBeTruthy();
  });

  it("top-aligns the next chunk when using J in focus mode", async () => {
    await renderBriefView();
    const scrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    Object.defineProperty(window, "scrollY", {
      configurable: true,
      value: 900,
    });

    fireEvent.keyDown(window, { key: "z" });
    await screen.findByRole("complementary", {
      name: "Focused change-group context",
    });

    const nextChunk = document.getElementById("chunk-b");
    expect(nextChunk).toBeTruthy();
    nextChunk!.getBoundingClientRect = () =>
      ({
        top: 360,
        bottom: 1200,
        left: 0,
        right: 800,
        width: 800,
        height: 840,
        x: 0,
        y: 360,
        toJSON: () => undefined,
      }) as DOMRect;
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    scrollTo.mockClear();

    fireEvent.keyDown(window, { key: "j" });

    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({
          behavior: "smooth",
          top: expect.any(Number),
        }),
      ),
    );
    const lastArg: unknown = scrollTo.mock.lastCall?.[0];
    if (
      typeof lastArg !== "object" ||
      lastArg === null ||
      !("top" in lastArg)
    ) {
      throw new Error("expected scrollTo to be called with options");
    }
    expect(lastArg.top).toBeLessThan(1260);
  });

  it("entering focus mode scrolls the active chunk clear of the focus banner", async () => {
    await renderBriefView();
    const scrollTo = vi
      .spyOn(window, "scrollTo")
      .mockImplementation(() => undefined);
    scrollTo.mockClear();

    fireEvent.keyDown(window, { key: "z" });
    await screen.findByRole("complementary", {
      name: "Focused change-group context",
    });

    // Regression: toggleFocusMode/startReadThrough used to scroll with the
    // default "native" alignment (plain scrollIntoView), which doesn't
    // reserve space for the focus banner that only mounts once focus mode is
    // active, and the banner then rendered on top of the chunk just scrolled
    // to. Entering focus mode must use the offset-aware "top" alignment,
    // same as J/K navigation while focus mode is already active.
    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({
          behavior: "smooth",
          top: expect.any(Number),
        }),
      ),
    );
  });

  it("offers no comment composer: a file-backed brief is read-only", async () => {
    // No `brief` row, no installation and no reviewer, so there is no session
    // to save a comment into and the gutter never opens one.
    await renderBriefView();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    fireEvent.keyDown(window, { key: "z" });
    await screen.findByRole("complementary", {
      name: "Focused change-group context",
    });
    expect(document.querySelector("[data-commentable]")).toBeNull();

    // The keyboard walk still works. Read-only is not inert.
    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() =>
      expect(document.querySelector("article[data-current]")?.id).toBe(
        "chunk-b",
      ),
    );
  });

  it("marking a core chunk reviewed advances the chunks progress stat", async () => {
    await renderBriefView();
    const stat = () => statText("Chunks");
    expect(stat()).toBe("0/2");
    fireEvent.click(screen.getAllByRole("checkbox", { name: /Viewed/i })[0]!);
    await waitFor(() => expect(stat()).toBe("1/2"));
  });

  it("dismissing selected flags advances the flags progress stat", async () => {
    await renderWritableScreen();
    const stat = () => statText("Flags");
    expect(stat()).toBe("0/2");
    fireEvent.click(screen.getByRole("checkbox", { name: /Select flags on/ }));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss selected…" }));
    const reason = await screen.findByPlaceholderText(/Your reason lands/);
    fireEvent.change(reason, {
      target: { value: "Not applicable in this local fixture." },
    });
    fireEvent.click(screen.getByText("Dismiss with reason"));
    await waitFor(() => expect(stat()).toBe("2/2"));
  });

  it("offers no disposition controls: a file-backed brief is read-only", async () => {
    // Same reason the composer never opens here, since there is no session to
    // record a dismissal in, so the affordance does not render at all.
    await renderBriefView();
    expect(statText("Flags")).toBe("0/2");
    expect(screen.queryByText("Dismiss…")).toBeNull();
  });

  it("lists unique risk-attribute names in the toolbar's risk-attrs panel", async () => {
    // The panel stays closed until the trigger opens it, never auto-open,
    // even on floor fire.
    await renderBriefView();
    expect(document.querySelector("[data-attribute-jump-rail]")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Risk attributes/ }));
    const section = document.querySelector("[data-attribute-jump-rail]");
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain("No tests");
    expect(section?.textContent).toContain("Comment contradicts code");
  });

  it("places the intent bar in the masthead's bar stack", async () => {
    await renderBriefView({
      ...briefFixture,
      intentCheck: {
        ticketUrls: [],
        ticketTitles: [],
        specificity: "none",
        scopeNote: "PR description only",
        accomplished: [
          {
            intent: "Cap the summary",
            quote: "cap it",
            sourceUrl: "",
            groupIds: [],
            acknowledged: false,
          },
        ],
        statedButMissing: [],
        doneButUnstated: [],
        deviations: [],
        maskedFixes: [],
      },
    });
    const summary = screen.getByTestId("brief-summary");
    const intentBar = document.querySelector("[data-intent-bar]");
    expect(intentBar).not.toBeNull();
    const following =
      summary.compareDocumentPosition(intentBar!) &
      Node.DOCUMENT_POSITION_FOLLOWING;
    expect(following).toBeTruthy();
    const stack = intentBar?.parentElement;
    const generatedBar = screen.getByTestId("generated-bar");
    expect(stack?.contains(generatedBar)).toBe(true);
    const afterGenerated =
      generatedBar.compareDocumentPosition(intentBar!) &
      Node.DOCUMENT_POSITION_FOLLOWING;
    expect(afterGenerated).toBeTruthy();
  });

  it("focus mode empties the region: summary + toolbar leave", async () => {
    await renderBriefView();
    expect(screen.getByTestId("brief-summary")).toBeTruthy();
    expect(screen.getByTestId("reading-toolbar")).toBeTruthy();

    fireEvent.keyDown(window, { key: "z" });

    await waitFor(() =>
      expect(screen.queryByTestId("brief-summary")).toBeNull(),
    );
    expect(screen.queryByTestId("reading-toolbar")).toBeNull();
  });

  it("places the Sidebar landmark after main, holding the group lines", async () => {
    await renderBriefView();
    const landmarks = [...document.querySelectorAll("main, aside")].map(
      (element) => element.tagName,
    );
    expect(landmarks).toEqual(["MAIN", "ASIDE"]);
    const aside = screen.getByRole("complementary", { name: "Sidebar" });
    expect(
      within(aside).getByRole("navigation", { name: "Change groups" }),
    ).toBeTruthy();
    expect(screen.getByRole("main").getAttribute("data-sidebar")).toBe(
      "collapsed",
    );
  });

  it("S expands the sidebar and focus mode hides it, preference kept", async () => {
    await renderBriefView();

    fireEvent.keyDown(window, { key: "s" });

    await waitFor(() =>
      expect(screen.getByRole("main").getAttribute("data-sidebar")).toBe(
        "expanded",
      ),
    );
    expect(screen.getByRole("tab", { name: "This PR" })).toBeTruthy();

    fireEvent.keyDown(window, { key: "z" });

    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Sidebar" }),
      ).toBeNull(),
    );
    expect(screen.getByRole("main").getAttribute("data-sidebar")).toBeNull();
    expect(
      JSON.parse(window.localStorage.getItem("mergebrief.sidebar") ?? ""),
    ).toEqual({ expanded: true, tab: "this-pr" });

    fireEvent.keyDown(window, { key: "z" });

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "This PR" })).toBeTruthy(),
    );
  });

  it("hiding the sidebar with focus inside lands focus on the content", async () => {
    await renderBriefView();
    const chevron = screen.getByRole("button", { name: "Expand sidebar" });
    chevron.focus();

    fireEvent.keyDown(window, { key: "z" });

    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", { name: "Sidebar" }),
      ).toBeNull(),
    );
    expect(document.activeElement).toBe(screen.getByRole("main"));
  });

  // Changes-only's summary-only column is not reachable here: the
  // single-artifact local fixture has no comparison baseline, so `changes`
  // normalizes back to `full`. That cell is pinned by regions.test.

  it("keeps the split-intent categories bolded inside the sentence", async () => {
    // One <Trans> sentence: a short components array would drop the <b> and
    // the category names with it, leaving the question with no candidates.
    await renderWritableScreen();
    const bolded = [...document.querySelectorAll("b")].map(
      (node) => node.textContent,
    );
    expect(bolded).toContain("bug fix vs logic refactor");
    // Whole sentence, so the separator spacing is pinned too, because losing the
    // space around the slot welds the categories to the preceding colon.
    expect(screen.getByText(/categorizer is split/).textContent).toBe(
      "The categorizer is split on this group\u2019s intent: bug fix vs logic refactor. Your call; the receipt records the override.",
    );
  });

  it("reclassifying an uncertain group records the override on the card", async () => {
    await renderWritableScreen();
    expect(
      screen.queryByText("Set by you, recorded on the receipt"),
    ).toBeNull();
    // The uncertain pick buttons offer the between-categories.
    fireEvent.click(screen.getByRole("button", { name: "Logic refactor" }));
    await waitFor(() =>
      expect(
        screen.getByText("Set by you, recorded on the receipt"),
      ).toBeTruthy(),
    );
  });
});
