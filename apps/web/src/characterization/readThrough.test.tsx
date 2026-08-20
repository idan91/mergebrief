// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
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
import { BriefView } from "../features/brief";
import { emptySessionPayload } from "../features/review/session";
import { I18nProvider } from "../i18n/I18nProvider";

const emptySession = emptySessionPayload();

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
      dominantCategory: Categories.BUGFIX,
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
    {
      id: "g2",
      title: "Second group",
      summary: "The second change-group.",
      dominantCategory: Categories.LOGIC_REFACTOR,
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
      concern: Concerns.IMPLEMENTATION,
      role: Roles.CORE,
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
      concern: Concerns.IMPLEMENTATION,
      role: Roles.CORE,
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
      concern: Concerns.IMPLEMENTATION,
      role: Roles.CORE,
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
      concern: Concerns.IMPLEMENTATION,
      role: Roles.CORE,
      loc: { added: 2, deleted: 0 },
      addedRanges: [{ start: 1, end: 2 }],
      removedRanges: [],
      riskSurface: [],
      diff: [{ kind: "hunk", content: "@@ -0,0 +1,2 @@" }],
    },
  ],
  concernView: [{ concern: Concerns.IMPLEMENTATION, added: 8, deleted: 0 }],
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

/**
 * The screen with a live session, rendered directly rather than through the
 * file route: a file-backed brief has no session and is read-only, so the
 * route harness could only pin refusals. Read-through IS the write path.
 */
async function renderReadThroughScreen() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <BriefView
          artifacts={[summaryFixture]}
          brief={readThroughFixture}
          briefId={summaryFixture.id}
          searchParams={{}}
          session={emptySession}
        />
      </QueryClientProvider>
    </I18nProvider>,
  );
  await waitFor(() =>
    expect(screen.getByText(readThroughFixture.pr.title)).toBeTruthy(),
  );
  return { queryClient };
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
  afterEach(cleanup);

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

  it("un-checks an already-viewed chunk in place — a correction, never an advance", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    // Mark the last chunk of group 1 viewed in normal mode first — this is
    // how a chunk viewed earlier in the session (snapshots persist) looks.
    fireEvent.click(viewedCheckboxFor("chunk-2"));
    await waitFor(() =>
      expect(viewedCheckboxFor("chunk-2").checked).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: "Start read-through" }));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-1"));
    fireEvent.click(viewedCheckboxFor("chunk-1"));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-2"));

    // Un-checking un-views and STAYS; advancing past a viewed chunk is J's job.
    fireEvent.click(viewedCheckboxFor("chunk-2"));
    await waitFor(() =>
      expect(viewedCheckboxFor("chunk-2").checked).toBe(false),
    );
    expect(activeChunkId()).toBe("chunk-2");
  });

  it("V announces mark/unmark to the page live region", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: "Start read-through" }));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-1"));

    fireEvent.keyDown(window, { key: "v" });
    await waitFor(() =>
      expect(screen.getByTestId("brief-toast").textContent).toBe(
        "Marked viewed",
      ),
    );
    await waitFor(() => expect(activeChunkId()).toBe("chunk-2"));

    fireEvent.keyDown(window, { key: "k" });
    await waitFor(() => expect(activeChunkId()).toBe("chunk-1"));
    fireEvent.keyDown(window, { key: "v" });
    await waitFor(() =>
      expect(screen.getByTestId("brief-toast").textContent).toBe(
        "Viewed unchecked",
      ),
    );
    expect(activeChunkId()).toBe("chunk-1");
  });

  it("still un-views an already-viewed chunk outside read-through", async () => {
    await renderReadThroughScreen();

    fireEvent.click(viewedCheckboxFor("chunk-1"));
    await waitFor(() =>
      expect(viewedCheckboxFor("chunk-1").checked).toBe(true),
    );

    fireEvent.click(viewedCheckboxFor("chunk-1"));
    await waitFor(() =>
      expect(viewedCheckboxFor("chunk-1").checked).toBe(false),
    );
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

  it("auto-advances in focus mode entered via Z, same as Start read-through", async () => {
    // Z-focus and Start-read-through are visually identical, so gating advance
    // on the entry path reads as broken. Viewed advances in ANY focus mode.
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    fireEvent.keyDown(window, { key: "z" });
    await screen.findByRole("complementary", {
      name: "Focused change-group context",
    });
    expect(activeChunkId()).toBe("chunk-1");

    fireEvent.click(viewedCheckboxFor("chunk-1"));
    await waitFor(() =>
      expect(viewedCheckboxFor("chunk-1").checked).toBe(true),
    );
    await waitFor(() => expect(activeChunkId()).toBe("chunk-2"));
  });

  it("keeps the focus banner's key hints as kbd elements", async () => {
    // The banner is one <Trans> sentence: a short components array would drop
    // a <kbd> and its letter with it, leaving "to move," with nothing to press.
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    fireEvent.keyDown(window, { key: "z" });
    const banner = await screen.findByTestId("focus-banner");
    expect(
      [...banner.querySelectorAll("kbd")].map((k) => k.textContent),
    ).toEqual(["J", "K", "V", "Esc"]);
    expect(banner.textContent).toContain("Focus mode");
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

  it("exiting focus mode restores normal viewed toggling (no advance, uncheck works)", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: "Start read-through" }));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-1"));
    fireEvent.click(viewedCheckboxFor("chunk-1"));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-2"));

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", {
          name: "Focused change-group context",
        }),
      ).toBeNull(),
    );

    // Outside focus mode, clicking a viewed chunk's checkbox un-checks it —
    // the confirm-and-advance semantics apply to focus mode only.
    fireEvent.click(viewedCheckboxFor("chunk-1"));
    await waitFor(() =>
      expect(viewedCheckboxFor("chunk-1").checked).toBe(false),
    );
  });
});
