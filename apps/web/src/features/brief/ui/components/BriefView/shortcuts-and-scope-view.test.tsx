// @vitest-environment jsdom
import type { RevisionNarrative } from "brief-core/types";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Button } from "@web/components/Button";
import { MarkLoaderTones } from "@web/components/MarkLoader/types";
import type { BriefAddressPort } from "./address/types";
import { buildFileAddress } from "./address/utils";
import type { BriefSearchParams } from "../../../model/comparison/compare-state";
import type { ComparisonMarks } from "../../../model/types";
import { PENDING_APPEAR_MS } from "../../hooks/useDelayedPending";
import { useBriefReading } from "../../hooks/useBriefReading";
import {
  briefFixture,
  briefSummaryFixture,
  FixtureBriefView,
  mountBriefHost,
  mountBriefView,
} from "@web/features/brief/test-utils";
import { BriefView } from ".";

const lastReviewMarks: ComparisonMarks = {
  baselineSha: "chk1234",
  headSha: briefFixture.pr.sha,
  baselineLabel: "checkpoint",
  baselineIndex: 1,
  files: [],
};

const briefWithRemainder = {
  ...briefFixture,
  unattributed: [
    {
      file: "src/orphan.ts",
      addedRanges: [{ start: 1, end: 4 }],
      removedRanges: [],
    },
  ],
};

const previousBriefMarks: ComparisonMarks = {
  baselineSha: "prev1234",
  headSha: briefFixture.pr.sha,
  baselineLabel: "previous-brief",
  baselineIndex: 1,
  files: [],
};

/** A narrative chunk over the fixture's flagged chunk, so its section carries the flags. */
const narrative: RevisionNarrative = {
  artifactKind: "revisionNarrative",
  pr: briefFixture.pr,
  prevHeadSha: "prev1234",
  headSha: briefFixture.pr.sha,
  prevIndex: 1,
  headIndex: 2,
  generation: { provider: "anthropic", model: "m", effort: null },
  overview: "This revision tightens the leak check.",
  chunks: [
    {
      id: "rc1",
      briefChangeGroupId: "g1",
      file: "src/leak.ts",
      addedRanges: [{ start: 10, end: 13 }],
      removedRanges: [],
      summary: "Tightens the check.",
    },
  ],
};

function NarrativeHarness() {
  const [search, setSearch] = useState<BriefSearchParams>({
    view: "changes",
    compare: "previous-brief",
  });
  return (
    <FixtureBriefView
      comparisonPlan={{
        previousBrief: {
          marks: {
            queryKey: ["test-previous-marks"],
            queryFn: () => Promise.resolve(previousBriefMarks),
          },
          narrative: {
            queryKey: ["test-narrative"],
            queryFn: () => Promise.resolve(narrative),
          },
        },
      }}
      exitChangesScope={() =>
        setSearch({ view: "full", compare: "previous-brief" })
      }
      searchParams={search}
    />
  );
}

function viewedBoxes(): HTMLInputElement[] {
  return screen
    .getAllByRole("checkbox", { name: /Viewed/ })
    .filter((box): box is HTMLInputElement => box instanceof HTMLInputElement);
}

const NO_SESSION_REASON = /no review session to save work to/;

function ignoreWrite(): void {}

const IGNORED_PORT: BriefAddressPort = {
  link: undefined,
  navigateLink: ignoreWrite,
  setFocusParam: ignoreWrite,
  clearDiffParam: ignoreWrite,
  navigateSearch: ignoreWrite,
};

function ReadingOnlyHost() {
  const reading = useBriefReading({
    brief: briefFixture,
    briefId: briefSummaryFixture.id,
  });
  const address = buildFileAddress({
    port: IGNORED_PORT,
    searchParams: {},
    revisionPending: false,
  });

  return <BriefView reading={reading} address={address} />;
}

function listViewedBoxes(): HTMLInputElement[] {
  return screen
    .getAllByRole("checkbox", { name: /Viewed/ })
    .filter((box): box is HTMLInputElement => box instanceof HTMLInputElement);
}

function main(): HTMLElement {
  const region = document.getElementById("main-content");
  if (region === null) {
    throw new Error("main-content not rendered");
  }
  return region;
}

describe("focus panel scope", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it("keeps the panel and its Escape claim out of Changes scope", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await mountBriefView({
      comparisonPlan: {
        lastReview: {
          marks: {
            queryKey: ["test-focus-scope-marks"],
            queryFn: () => Promise.resolve(lastReviewMarks),
          },
        },
      },
      searchParams: { view: "changes", compare: "last-review" },
    });

    fireEvent.keyDown(window, { key: "z" });
    await screen.findByTestId("focus-indicator");
    expect(screen.queryByTestId("focus-panel")).toBeNull();

    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByTestId("focus-indicator")).toBeNull(),
    );
  });
});

describe("jumps out of the Changes scope", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  describe("Flag jump from Changes scope", () => {
    it("exits to Full and scrolls to the flagged chunk", async () => {
      vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

      await mountBriefHost(<NarrativeHarness />);
      const fileButton = await screen.findByRole("button", {
        name: "src/leak.ts",
      });

      fireEvent.click(fileButton);

      await waitFor(() => expect(document.activeElement?.id).toBe("chunk-a"));
    });
  });

  describe("Card jump from Changes scope", () => {
    it("exits to Full and scrolls to the card's owner chunk", async () => {
      vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

      await mountBriefHost(<NarrativeHarness />);
      const jump = await screen.findByRole("button", {
        name: "Show in Full brief, src/leak.ts",
      });

      fireEvent.click(jump);

      await waitFor(() => expect(document.activeElement?.id).toBe("chunk-a"));
    });
  });

  describe("Header Jump from Changes scope", () => {
    it("exits to Full and focuses the remainder heading", async () => {
      vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);

      function Harness() {
        const [search, setSearch] = useState<BriefSearchParams>({
          view: "changes",
          compare: "last-review",
        });
        return (
          <FixtureBriefView
            brief={briefWithRemainder}
            comparisonPlan={{
              lastReview: {
                marks: {
                  queryKey: ["test-last-review-marks"],
                  queryFn: () => Promise.resolve(lastReviewMarks),
                },
              },
            }}
            exitChangesScope={() =>
              setSearch({ view: "full", compare: "last-review" })
            }
            searchParams={search}
          />
        );
      }

      await mountBriefHost(<Harness />);
      await waitFor(() =>
        expect(
          screen.getAllByRole("heading", {
            level: 1,
            name: briefFixture.pr.title,
          }),
        ).toBeTruthy(),
      );
      expect(
        document.getElementById("unattributed-remainder-heading"),
      ).toBeNull();

      fireEvent.click(screen.getByTestId("unattributed-disclosure"));
      fireEvent.click(screen.getByRole("button", { name: "Jump to group" }), {
        detail: 0,
      });

      await waitFor(() =>
        expect(document.activeElement?.id).toBe(
          "unattributed-remainder-heading",
        ),
      );
    });
  });
});

describe("V in Changes scope", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  function Harness() {
    const [search, setSearch] = useState<BriefSearchParams>({
      view: "changes",
      compare: "last-review",
    });

    return (
      <>
        <Button
          onClick={() => setSearch({ view: "full", compare: "last-review" })}
        >
          to full
        </Button>
        <FixtureBriefView
          comparisonPlan={{
            lastReview: {
              marks: {
                queryKey: ["test-last-review-marks"],
                queryFn: () => Promise.resolve(lastReviewMarks),
              },
            },
          }}
          exitChangesScope={() =>
            setSearch({ view: "full", compare: "last-review" })
          }
          searchParams={search}
        />
      </>
    );
  }

  it("marks nothing viewed in Changes and the active chunk in Full", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await mountBriefHost(<Harness />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "to full" })).toBeTruthy(),
    );

    fireEvent.keyDown(window, { key: "z" });
    fireEvent.keyDown(window, { key: "v" });
    fireEvent.click(screen.getByRole("button", { name: "to full" }));

    await waitFor(() => expect(viewedBoxes().length).toBeGreaterThan(0));
    expect(viewedBoxes().some((box) => box.checked)).toBe(false);

    fireEvent.keyDown(window, { key: "v" });

    await waitFor(() =>
      expect(viewedBoxes().filter((box) => box.checked)).toHaveLength(1),
    );
  });
});

describe("a Brief with reading and address only", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  it("disables every write and says there is no review session", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
    await mountBriefHost(<ReadingOnlyHost />);

    await waitFor(() => expect(listViewedBoxes().length).toBeGreaterThan(0));
    expect(listViewedBoxes().every((box) => box.disabled)).toBe(true);

    fireEvent.keyDown(window, { key: "z" });
    fireEvent.keyDown(window, { key: "v" });

    expect(await screen.findAllByText(NO_SESSION_REASON)).not.toHaveLength(0);
  });
});

// The revision-pending treatment: while a revision navigation outlasts the
// pending delay, the stale content stays visible but goes non-interactive,
// dim (data-pending) + inert + aria-busy on the content region ONLY. The
// sticky header (revision, scope and comparison controls) must stay live so the reviewer
// can keep stepping; a small decorative loader rides beside the controls.
// Fast loads (shorter than the appearance delay) must show nothing at all.
describe("revision-pending treatment", () => {
  afterEach(() => {
    cleanup();
    window.sessionStorage.clear();
  });

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the content fully live when nothing is pending", async () => {
    await mountBriefView({ revisionPending: false });
    expect(main().hasAttribute("inert")).toBe(false);
    expect(main().hasAttribute("data-pending")).toBe(false);
    expect(main().getAttribute("aria-busy")).toBeNull();
    expect(screen.queryByTestId("revision-loader")).toBeNull();
  });

  it("dims and inerts ONLY the content region after the delay", async () => {
    await mountBriefView({ revisionPending: true });
    act(() => {
      vi.advanceTimersByTime(PENDING_APPEAR_MS);
    });
    expect(main().hasAttribute("inert")).toBe(true);
    expect(main().hasAttribute("data-pending")).toBe(true);
    expect(main().getAttribute("aria-busy")).toBe("true");

    // The sticky header stays operable: none of its controls sit inside an
    // inert ancestor. Submit lives in the header on the reviewer view.
    const submit = screen.getByRole("button", { name: "Submit" });
    const loader = screen.getByTestId("revision-loader");
    expect(submit.closest("[inert]")).toBeNull();
    expect(loader.closest("[inert]")).toBeNull();
    expect(loader.dataset["tone"]).toBe(MarkLoaderTones.MUTED);
  });

  it("stands the window-level keyboard shortcuts down while pending", async () => {
    // `inert` does not stop a window keydown listener, the shortcut layer
    // must disable itself, or `?`/j/k would act on the stale brief.
    await mountBriefView({ revisionPending: true });
    act(() => {
      vi.advanceTimersByTime(PENDING_APPEAR_MS);
    });
    fireEvent.keyDown(window, { key: "?" });
    expect(
      screen.getByText("Keyboard shortcuts").closest("[data-state]"),
    ).toMatchObject({ dataset: { state: "closed" } });
  });
});
