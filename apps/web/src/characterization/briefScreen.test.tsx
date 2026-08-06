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
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  localBriefQueryOptions,
  localBriefsQueryOptions,
  localRevisionChangesQueryOptions,
} from "../features/brief/queries";
import {
  briefFixture,
  briefSummaryFixture,
} from "@web/features/brief/utils/fixtures";
import { routeTree } from "../routeTree.gen";

const BRIEF_ID = briefSummaryFixture.id;

async function renderBriefScreen(brief = briefFixture) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(localBriefQueryOptions(BRIEF_ID).queryKey, brief);
  queryClient.setQueryData(localBriefsQueryOptions().queryKey, [
    briefSummaryFixture,
  ]);
  queryClient.setQueryData(
    localRevisionChangesQueryOptions(BRIEF_ID).queryKey,
    null,
  );

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
  await waitFor(() => expect(screen.getByText(brief.pr.title)).toBeTruthy());
  return { queryClient, router };
}

/**
 * Characterization suite — pins the screen's load-bearing couplings against the
 * pre-split BriefApp so they stay green through the Slice A→D refactor. Asserts
 * behaviour observable through the rendered screen, not store internals.
 */
function statText(label: string): string | null {
  const stat = screen.getByText(label).closest(".stat");
  return stat?.querySelector("b")?.textContent ?? null;
}

describe("brief screen characterization", () => {
  afterEach(() => cleanup());

  it("renders the change-group story", async () => {
    await renderBriefScreen();
    expect(screen.getByText(briefFixture.changeGroups[0]!.title)).toBeTruthy();
  });

  it("enters story focus mode with a visible active chunk from concerns view", async () => {
    await renderBriefScreen();
    fireEvent.click(screen.getByRole("radio", { name: "Concerns" }));

    fireEvent.keyDown(window, { key: "z" });

    expect(
      (screen.getByRole("radio", { name: "Story" }) as HTMLInputElement)
        .checked,
    ).toBe(true);
    await waitFor(() =>
      expect(
        document.querySelector(".story-group[data-active-group]"),
      ).toBeTruthy(),
    );
    expect(document.querySelector("article[data-current]")).toBeTruthy();
  });

  it("shows collapsible change-group context in focus mode", async () => {
    await renderBriefScreen();

    fireEvent.keyDown(window, { key: "z" });

    const rail = await screen.findByRole("complementary", {
      name: "Focused change-group context",
    });
    expect(rail.textContent).toContain(briefFixture.changeGroups[0]!.title);
    expect(rail.textContent).toContain(briefFixture.changeGroups[0]!.summary);
    expect(rail.textContent).toContain("Active chunk risks");
    expect(rail.textContent).toContain("no-tests");

    const toggle = screen.getByRole("button", {
      name: "Collapse group context",
    });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(rail.textContent).toContain("Group 1");
    expect(rail.textContent).not.toContain(
      briefFixture.changeGroups[0]!.summary,
    );
  });

  it("top-aligns the next chunk when using J in focus mode", async () => {
    await renderBriefScreen();
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

    fireEvent.keyDown(window, { key: "j" });

    await waitFor(() =>
      expect(scrollTo).toHaveBeenCalledWith(
        expect.objectContaining({ behavior: "auto", top: expect.any(Number) }),
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
    await renderBriefScreen();
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
    // active — the banner then rendered on top of the chunk just scrolled
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

  it("keeps J/K/Z working after leaving a comment composer via Escape", async () => {
    await renderBriefScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    fireEvent.keyDown(window, { key: "z" });
    await screen.findByRole("complementary", {
      name: "Focused change-group context",
    });

    // Open the composer on a commentable diff row, then leave it via Escape
    // — not the Cancel button. Regression: CommentComposer never wired
    // Escape to its own dismiss handler (unlike Modal, which does this for
    // every other overlay in the app), so Escape did nothing while it was
    // open; `activeCommentAnchor` never cleared, `shortcutsDisabled` stayed
    // true, and J/K/Z stayed dead until the reviewer noticed they had to
    // click Cancel/save explicitly.
    // Composer entry is gutter-only since BRIEF-14 (the code column is
    // reserved for text selection).
    const gutter = document.querySelector(
      "[data-commentable] [data-line-number]",
    );
    expect(gutter).toBeTruthy();
    fireEvent.mouseDown(gutter!);
    fireEvent.mouseUp(gutter!);
    await screen.findByPlaceholderText("Leave a comment");

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByPlaceholderText("Leave a comment")).toBeNull(),
    );

    fireEvent.keyDown(window, { key: "j" });
    await waitFor(() =>
      expect(document.querySelector("article[data-current]")?.id).toBe(
        "chunk-b",
      ),
    );
  });

  it("marking a carrier chunk reviewed advances the chunks progress stat", async () => {
    await renderBriefScreen();
    const stat = () => statText("chunks");
    expect(stat()).toBe("0/2");
    fireEvent.click(screen.getAllByRole("checkbox", { name: /Viewed/i })[0]!);
    await waitFor(() => expect(stat()).toBe("1/2"));
  });

  it("dismissing a flag advances the flags progress stat", async () => {
    await renderBriefScreen();
    const stat = () => statText("flags");
    expect(stat()).toBe("0/2");
    fireEvent.click(screen.getAllByText("Dismiss…")[0]!);
    const reason = await screen.findByPlaceholderText(/Your reason lands/);
    fireEvent.change(reason, {
      target: { value: "Not applicable in this local fixture." },
    });
    fireEvent.click(screen.getByText("Dismiss with reason"));
    await waitFor(() => expect(stat()).toBe("1/2"));
  });

  it("links Summary preview from the header menu on the local path", async () => {
    await renderBriefScreen();
    // The local path renders the cross-route LINK variant (BRIEF-28 menu).
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    const item = screen.getByRole("menuitem", { name: /^summary preview$/i });
    expect(item.getAttribute("href")).toContain(
      `/briefs/${BRIEF_ID}/summary-preview`,
    );
  });

  it("lists unique risk-attribute names in the attribute jump-rail", async () => {
    await renderBriefScreen();
    const section = document.querySelector("[data-attribute-jump-rail]");
    expect(section).not.toBeNull();
    expect(section?.textContent).toContain("no-tests");
    expect(section?.textContent).toContain("comment-contradicts-code");
  });

  it("renders a flag's riskNotes evidence as a secondary line in the rail", async () => {
    await renderBriefScreen();
    expect(
      screen.getByText(
        "comment says the param is optional (L10), code throws when absent (L12)",
      ),
    ).toBeTruthy();
  });

  it("renders the intent bar directly beneath the summary (BRIEF-134)", async () => {
    await renderBriefScreen({
      ...briefFixture,
      intentCheck: {
        ticketUrls: [],
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
        claimedButUnachieved: [],
      },
    });
    const summary = screen.getByTestId("brief-summary");
    const intentBar = document.querySelector("[data-intent-bar]");
    expect(intentBar).not.toBeNull();
    expect(summary.nextElementSibling).toBe(intentBar);
  });

  it("reclassifying an uncertain group records the override on the card", async () => {
    await renderBriefScreen();
    expect(screen.queryByText("set by you · recorded on receipt")).toBeNull();
    // The uncertain pick buttons offer the between-categories.
    fireEvent.click(screen.getByRole("button", { name: "logic-refactor" }));
    await waitFor(() =>
      expect(screen.getByText("set by you · recorded on receipt")).toBeTruthy(),
    );
  });
});
