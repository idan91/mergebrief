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
  Categories,
  Concerns,
  Roles,
  type Brief,
  type LocalBriefSummary,
} from "../features/brief/types";
import {
  localBriefQueryOptions,
  localBriefsQueryOptions,
  localRevisionChangesQueryOptions,
} from "../features/brief/queries";
import { clearSnapshots } from "../features/review/session";
import { routeTree } from "../routeTree.gen";

/**
 * Two groups of two chunks each — the minimal shape that exercises
 * within-group advance, cross-group-boundary advance, and end-of-sequence
 * stop, none of which the single-group `briefFixture` can cover.
 */
const readThroughFixture: Brief = {
  artifactKind: "brief",
  pr: {
    repo: "acme/widgets",
    number: 7,
    title: "Fixture: read-through auto-advance",
    url: "https://example.com/pr/7",
    sha: "1234567890abcdef",
    description: "Fixture PR description.",
  },
  summary: "Fixture brief summary.",
  index: 1,
  changeGroups: [
    {
      id: "g1",
      title: "First group",
      summary: "The first change-group.",
      dominantCategory: Categories.Bugfix,
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
    {
      id: "g2",
      title: "Second group",
      summary: "The second change-group.",
      dominantCategory: Categories.LogicRefactor,
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
  ],
  chunks: [
    {
      id: "chunk-1",
      changeGroupId: "g1",
      file: "src/one.ts",
      concern: Concerns.Implementation,
      role: Roles.Carrier,
      loc: { added: 2, deleted: 0 },
      addedRanges: [{ start: 1, end: 2 }],
      removedRanges: [],
      riskSurface: [],
      diff: [{ kind: "hunk", content: "@@ -0,0 +1,2 @@" }],
    },
    {
      id: "chunk-2",
      changeGroupId: "g1",
      file: "src/two.ts",
      concern: Concerns.Implementation,
      role: Roles.Carrier,
      loc: { added: 2, deleted: 0 },
      addedRanges: [{ start: 1, end: 2 }],
      removedRanges: [],
      riskSurface: [],
      diff: [{ kind: "hunk", content: "@@ -0,0 +1,2 @@" }],
    },
    {
      id: "chunk-3",
      changeGroupId: "g2",
      file: "src/three.ts",
      concern: Concerns.Implementation,
      role: Roles.Carrier,
      loc: { added: 2, deleted: 0 },
      addedRanges: [{ start: 1, end: 2 }],
      removedRanges: [],
      riskSurface: [],
      diff: [{ kind: "hunk", content: "@@ -0,0 +1,2 @@" }],
    },
    {
      id: "chunk-4",
      changeGroupId: "g2",
      file: "src/four.ts",
      concern: Concerns.Implementation,
      role: Roles.Carrier,
      loc: { added: 2, deleted: 0 },
      addedRanges: [{ start: 1, end: 2 }],
      removedRanges: [],
      riskSurface: [],
      diff: [{ kind: "hunk", content: "@@ -0,0 +1,2 @@" }],
    },
  ],
  concernView: [{ concern: Concerns.Implementation, added: 8, deleted: 0 }],
};

const summaryFixture: LocalBriefSummary = {
  id: "fixture-read-through",
  artifactKind: "brief",
  repo: readThroughFixture.pr.repo,
  number: readThroughFixture.pr.number,
  title: readThroughFixture.pr.title,
  sha: readThroughFixture.pr.sha,
  index: 1,
};

async function renderReadThroughScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  queryClient.setQueryData(
    localBriefQueryOptions(summaryFixture.id).queryKey,
    readThroughFixture,
  );
  queryClient.setQueryData(localBriefsQueryOptions().queryKey, [
    summaryFixture,
  ]);
  queryClient.setQueryData(
    localRevisionChangesQueryOptions(summaryFixture.id).queryKey,
    null,
  );

  const router = createRouter({
    routeTree,
    context: { queryClient },
    history: createMemoryHistory({
      initialEntries: [`/briefs/${summaryFixture.id}`],
    }),
  });
  await router.load();
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  await waitFor(() =>
    expect(screen.getByText(readThroughFixture.pr.title)).toBeTruthy(),
  );
  return { queryClient, router };
}

function activeChunkId(): string | undefined {
  return document.querySelector("article[data-current]")?.id;
}

function viewedCheckboxFor(chunkId: string): HTMLInputElement {
  const article = document.getElementById(chunkId);
  if (!article) throw new Error(`chunk ${chunkId} not rendered`);
  const checkbox = article.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  if (!checkbox) throw new Error(`no Viewed checkbox on ${chunkId}`);
  return checkbox;
}

describe("Read-through progress + auto-advance", () => {
  afterEach(() => {
    cleanup();
    clearSnapshots();
  });

  it("renders one progress segment per group, current segment marked with aria-current", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: "Start read-through" }));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-1"));

    const nav = screen.getByRole("navigation", {
      name: "Read-through progress",
    });
    const segments = nav.querySelectorAll("button");
    expect(segments).toHaveLength(2);
    expect(
      screen
        .getByRole("button", { name: "Group 1 of 2: First group" })
        .getAttribute("aria-current"),
    ).toBe("step");
    expect(
      screen
        .getByRole("button", { name: "Group 2 of 2: Second group" })
        .getAttribute("aria-current"),
    ).toBeNull();
  });

  it("clicking a progress segment jumps to that group's first chunk", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: "Start read-through" }));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-1"));

    fireEvent.click(
      screen.getByRole("button", { name: "Group 2 of 2: Second group" }),
    );
    await waitFor(() => expect(activeChunkId()).toBe("chunk-3"));
  });

  it("auto-advances to the strict next chunk when marking viewed in read-through", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: "Start read-through" }));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-1"));

    fireEvent.click(viewedCheckboxFor("chunk-1"));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-2"));
  });

  it("auto-advance across a group boundary lands on the next group's rail", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: "Start read-through" }));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-1"));
    fireEvent.click(viewedCheckboxFor("chunk-1"));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-2"));

    fireEvent.click(viewedCheckboxFor("chunk-2"));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-3"));

    const rail = screen.getByRole("complementary", {
      name: "Focused change-group context",
    });
    expect(rail.textContent).toContain("Second group");
  });

  it("does not wrap past the last chunk", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: "Start read-through" }));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-1"));
    for (const chunkId of ["chunk-1", "chunk-2", "chunk-3"]) {
      fireEvent.click(viewedCheckboxFor(chunkId));
      await waitFor(() => expect(activeChunkId()).not.toBe(chunkId));
    }
    expect(activeChunkId()).toBe("chunk-4");

    fireEvent.click(viewedCheckboxFor("chunk-4"));
    // No next chunk exists — stays put rather than wrapping to chunk-1.
    await waitFor(() => expect(activeChunkId()).toBe("chunk-4"));
  });

  it("does not auto-advance in plain focus mode entered via Z", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    fireEvent.keyDown(window, { key: "z" });
    await screen.findByRole("complementary", {
      name: "Focused change-group context",
    });
    expect(activeChunkId()).toBe("chunk-1");

    fireEvent.click(viewedCheckboxFor("chunk-1"));
    // No next-chunk navigation outside read-through — the checkbox toggles,
    // nothing else moves.
    await waitFor(() =>
      expect(viewedCheckboxFor("chunk-1").checked).toBe(true),
    );
    expect(activeChunkId()).toBe("chunk-1");
  });

  it("does not auto-advance outside focus mode entirely", async () => {
    await renderReadThroughScreen();

    fireEvent.click(viewedCheckboxFor("chunk-1"));
    await waitFor(() =>
      expect(viewedCheckboxFor("chunk-1").checked).toBe(true),
    );
    // Normal mode has no notion of an "active" chunk driven by read-through;
    // simply confirm marking viewed didn't throw/navigate and the checkbox
    // for the next chunk is untouched.
    expect(viewedCheckboxFor("chunk-2").checked).toBe(false);
  });

  it("Z-exiting read-through clears auto-advance (re-entering focus is plain)", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: "Start read-through" }));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-1"));

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", {
          name: "Focused change-group context",
        }),
      ).toBeNull(),
    );

    fireEvent.keyDown(window, { key: "z" });
    await screen.findByRole("complementary", {
      name: "Focused change-group context",
    });

    fireEvent.click(viewedCheckboxFor("chunk-1"));
    await waitFor(() =>
      expect(viewedCheckboxFor("chunk-1").checked).toBe(true),
    );
    expect(activeChunkId()).toBe("chunk-1");
  });
});
