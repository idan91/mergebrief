// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ChangeGroupCategories } from "types";
import { Concerns, Roles } from "brief-core/types";
import { type Brief, type LocalBriefSummary } from "../features/brief/types";
import { emptySessionPayload } from "../features/review/session";
import { mountBriefView } from "../features/brief/test-utils";

const emptySession = emptySessionPayload();

/**
 * Two groups of two chunks each, the minimal shape that exercises
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
      dominantCategory: ChangeGroupCategories.BUGFIX,
      secondaryCategories: [],
      uncertain: false,
      uncertainBetween: [],
    },
    {
      id: "g2",
      title: "Second group",
      summary: "The second change-group.",
      dominantCategory: ChangeGroupCategories.LOGIC_REFACTOR,
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
  await mountBriefView({
    artifacts: [summaryFixture],
    brief: readThroughFixture,
    briefId: summaryFixture.id,
    session: emptySession,
  });
  await waitFor(() =>
    expect(screen.getByText(readThroughFixture.pr.title)).toBeTruthy(),
  );
}

function activeChunkId(): string | undefined {
  return document.querySelector("article[data-current]")?.id;
}

function viewedCheckboxFor(chunkId: string): HTMLInputElement {
  const article = document.getElementById(chunkId);
  if (!article) {
    throw new Error(`chunk ${chunkId} not rendered`);
  }
  const checkbox = article.querySelector<HTMLInputElement>(
    'input[type="checkbox"]',
  );
  if (!checkbox) {
    throw new Error(`no Viewed checkbox on ${chunkId}`);
  }
  return checkbox;
}

describe("Read-through progress + auto-advance", () => {
  afterEach(cleanup);

  it("renders one progress segment per group and marks the current one", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: /Start read-through/ }));
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

    fireEvent.click(screen.getByRole("button", { name: /Start read-through/ }));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-1"));

    fireEvent.click(
      screen.getByRole("button", { name: "Group 2 of 2: Second group" }),
    );
    await waitFor(() => expect(activeChunkId()).toBe("chunk-3"));
  });

  it("advances to the strict next chunk when marking viewed in read-through", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: /Start read-through/ }));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-1"));

    fireEvent.click(viewedCheckboxFor("chunk-1"));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-2"));
  });

  it("un-checks an already-viewed chunk in place as a correction", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    // Mark the last chunk of group 1 viewed in normal mode first; this is
    // how a chunk viewed earlier in the session (snapshots persist) looks.
    fireEvent.click(viewedCheckboxFor("chunk-2"));
    await waitFor(() =>
      expect(viewedCheckboxFor("chunk-2").checked).toBe(true),
    );

    fireEvent.click(screen.getByRole("button", { name: /Start read-through/ }));
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

    fireEvent.click(screen.getByRole("button", { name: /Start read-through/ }));
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

    fireEvent.click(screen.getByRole("button", { name: /Start read-through/ }));
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

    fireEvent.click(screen.getByRole("button", { name: /Start read-through/ }));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-1"));
    for (const chunkId of ["chunk-1", "chunk-2", "chunk-3"]) {
      fireEvent.click(viewedCheckboxFor(chunkId));
      await waitFor(() => expect(activeChunkId()).not.toBe(chunkId));
    }
    expect(activeChunkId()).toBe("chunk-4");

    fireEvent.click(viewedCheckboxFor("chunk-4"));
    // No next chunk exists: stays put rather than wrapping to chunk-1.
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

  it("offers Start read-through in the toolbar and hides it in focus mode", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    const toolbar = screen.getByTestId("reading-toolbar");
    expect(
      within(toolbar).getByRole("button", { name: /Start read-through/ }),
    ).toBeTruthy();

    fireEvent.keyDown(window, { key: "z" });
    await screen.findByTestId("focus-indicator");
    expect(
      screen.queryByRole("button", { name: /Start read-through/ }),
    ).toBeNull();
  });

  it("shows the focus pill with its count and one exit", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    fireEvent.keyDown(window, { key: "z" });

    const pill = await screen.findByRole("group", { name: "Focus mode" });
    expect(within(pill).getByText(/Group 1 of \d+/)).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /Exit focus mode/ }),
    ).toHaveLength(1);
  });

  it("leaves focus mode from the pill's exit", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    fireEvent.keyDown(window, { key: "z" });

    const pill = await screen.findByRole("group", { name: "Focus mode" });
    fireEvent.click(
      within(pill).getByRole("button", { name: "Exit focus mode (Esc)" }),
    );
    await waitFor(() =>
      expect(screen.queryByTestId("focus-indicator")).toBeNull(),
    );
    expect(screen.queryByTestId("focus-shortcuts")).toBeNull();
    expect(document.activeElement?.id).toBe("main-content");
  });

  it("lists the focus keys as kbd elements in the shortcuts corner", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    fireEvent.keyDown(window, { key: "z" });

    const corner = await screen.findByTestId("focus-shortcuts");
    expect(
      [...corner.querySelectorAll("kbd")].map((cap) => cap.textContent),
    ).toEqual(["J", "K", "⇧Shift J", "⇧Shift K", "V", "S", "D", "Esc", "?"]);
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

  it("exiting focus mode restores normal viewed toggling with no advance", async () => {
    await renderReadThroughScreen();
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

    fireEvent.click(screen.getByRole("button", { name: /Start read-through/ }));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-1"));
    fireEvent.click(viewedCheckboxFor("chunk-1"));
    await waitFor(() => expect(activeChunkId()).toBe("chunk-2"));

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.getByTestId("focus-panel").dataset["state"]).toBe("closed"),
    );
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(
        screen.queryByRole("complementary", {
          name: "Focused change-group context",
        }),
      ).toBeNull(),
    );

    // Outside focus mode, clicking a viewed chunk's checkbox un-checks it,
    // the confirm-and-advance semantics apply to focus mode only.
    fireEvent.click(viewedCheckboxFor("chunk-1"));
    await waitFor(() =>
      expect(viewedCheckboxFor("chunk-1").checked).toBe(false),
    );
  });
});
