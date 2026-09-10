// @vitest-environment jsdom
// The carry-over row's four states, the span it always states, and the
// attention list's clearing affordances, driven through the real screen,
// because the list is what replaces the row and both are one region.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../../../../i18n/I18nProvider";
import type { ReviewSessionPayload } from "@web/features/review/session";
import { BriefView } from "../../BriefView/BriefView";
import { briefFixture } from "@web/features/brief/fixtures";

afterEach(cleanup);

const FLAG_ATTRIBUTE = "no-tests";
const FLAG_FILE = "src/leak.ts";
const DRAFT_ID = "4001";

function buildPayload(
  over: Partial<ReviewSessionPayload>,
): ReviewSessionPayload {
  return {
    materialized: true,
    carriedFrom: {
      sessionId: "9",
      headSha: "a84c1de0000",
      revisions: 1,
      items: 4,
    },
    attention: [],
    reviewOutcome: "comment",
    draftComments: [],
    readMarks: ["chunk-a"],
    reclassifications: [],
    dispositions: [],
    submittedReviewIds: [],
    ...over,
  };
}

function buildOrphanedDraft(): ReviewSessionPayload {
  return buildPayload({
    draftComments: [
      {
        id: DRAFT_ID,
        filePath: FLAG_FILE,
        kind: "line",
        side: "new",
        startLine: 10,
        endLine: 10,
        body: "Still worth checking.",
        status: "draft",
      },
    ],
    attention: [
      {
        kind: "orphaned-anchor",
        subject: { type: "draft-comment", id: DRAFT_ID, attribute: null },
        location: {
          kind: "line",
          filePath: FLAG_FILE,
          startLine: 10,
          endLine: 10,
        },
        clearedBy: ["reanchor-draft-comment", "delete-draft-comment"],
      },
    ],
  });
}

/** A carried disposition on the fixture's flagged region, plus its item. */
function buildCarriedDisposition(
  kind: "reopened-disposition" | "missing-evidence",
): ReviewSessionPayload {
  const carryStatus = kind === "reopened-disposition" ? "reopened" : "settled";
  return buildPayload({
    dispositions: [
      {
        filePath: FLAG_FILE,
        attribute: FLAG_ATTRIBUTE,
        regionStart: 10,
        regionEnd: 13,
        decision: "addressed",
        reason: null,
        evidence: null,
        carryStatus,
      },
    ],
    attention: [
      {
        kind,
        subject: {
          type: "disposition",
          id: null,
          attribute: FLAG_ATTRIBUTE,
        },
        location: {
          kind: "line",
          filePath: FLAG_FILE,
          startLine: 10,
          endLine: 13,
        },
        clearedBy: ["address-risk", "dismiss-risk"],
      },
    ],
  });
}

function renderScreen(session: ReviewSessionPayload | undefined) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <BriefView
          artifacts={[]}
          brief={briefFixture}
          briefId="carry-over-test"
          searchParams={{}}
          session={session}
        />
      </QueryClientProvider>
    </I18nProvider>,
  );
}

/** The item's re-anchor control, re-read after every state change. */
function getReanchorControl(): HTMLElement {
  return screen.getByTestId("attention-action-reanchor-draft-comment");
}

function getRowText(): string {
  return screen.getByTestId("carry-over-row").textContent ?? "";
}

describe("carry-over row", () => {
  it("renders no row at all on a first-ever session", () => {
    renderScreen(buildPayload({ carriedFrom: null }));
    expect(screen.queryByTestId("carry-over-row")).toBeNull();
  });

  it("renders no row when a previous session carried nothing", () => {
    renderScreen(
      buildPayload({
        carriedFrom: {
          sessionId: "9",
          headSha: "a84c1de0000",
          revisions: 2,
          items: 0,
        },
      }),
    );
    expect(screen.queryByTestId("carry-over-row")).toBeNull();
  });

  it("states the receipt work, count, span, and nothing to re-look at", () => {
    renderScreen(buildPayload({}));
    expect(getRowText()).toContain("Your review carried forward · 4 items");
    expect(getRowText()).toContain("a84c1de → abcdef1");
    expect(getRowText()).toContain("nothing needs a re-look");
    expect(screen.queryByTestId("attention-item")).toBeNull();
  });

  it("counts the revisions when more than one push happened", () => {
    renderScreen(
      buildPayload({
        carriedFrom: {
          sessionId: "9",
          headSha: "a84c1de0000",
          revisions: 3,
          items: 4,
        },
      }),
    );
    expect(getRowText()).toContain("a84c1de → abcdef1 · 3 revisions");
  });

  it("suppresses the count when both span ends are the same SHA", () => {
    renderScreen(
      buildPayload({
        carriedFrom: {
          sessionId: "9",
          headSha: briefFixture.pr.sha,
          revisions: 4,
          items: 4,
        },
      }),
    );
    expect(getRowText()).toContain("abcdef1 → abcdef1");
    expect(getRowText()).not.toContain("revisions");
  });

  it("replaces the receipt verdict with pending items and keeps the span", () => {
    renderScreen(buildOrphanedDraft());
    expect(getRowText()).toContain("1 item needs a re-look");
    expect(getRowText()).toContain("a84c1de → abcdef1");
    expect(screen.getAllByTestId("attention-item")).toHaveLength(1);
    expect(screen.getByText("Draft comment lost its lines")).toBeTruthy();
    // Not a notification: nothing dismisses the row.
    expect(screen.queryByRole("button", { name: /dismiss$/i })).toBeNull();
  });

  it("returns to the receipt when the last item clears, never to nothing", () => {
    renderScreen(buildOrphanedDraft());
    fireEvent.click(
      screen.getByTestId("attention-action-delete-draft-comment"),
    );
    expect(screen.queryByTestId("attention-item")).toBeNull();
    expect(getRowText()).toContain("nothing needs a re-look");
  });

  it("arms placement for the re-anchor operation the item names", () => {
    renderScreen(buildOrphanedDraft());
    fireEvent.click(getReanchorControl());
    // The next picked row places it; until then the item stands.
    expect(screen.getAllByTestId("attention-item")).toHaveLength(1);
    const gutter = document.querySelector(
      "[data-commentable] [data-line-number]",
    );
    expect(gutter).toBeTruthy();
    fireEvent.mouseDown(gutter as Element);
    fireEvent.mouseUp(gutter as Element);
    // Placement, not a composer: the draft moved instead of a new one opening.
    expect(screen.queryByPlaceholderText("Leave a comment")).toBeNull();
    expect(screen.queryByTestId("attention-item")).toBeNull();
  });

  it("disarms placement when the re-anchor control is pressed again", () => {
    renderScreen(buildOrphanedDraft());
    fireEvent.click(getReanchorControl());
    expect(getReanchorControl().getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(getReanchorControl());
    expect(getReanchorControl().getAttribute("aria-pressed")).toBe("false");
    // Disarmed: the next picked row opens a composer, as it always would.
    const gutter = document.querySelector(
      "[data-commentable] [data-line-number]",
    );
    fireEvent.mouseDown(gutter as Element);
    fireEvent.mouseUp(gutter as Element);
    expect(screen.getByPlaceholderText("Leave a comment")).toBeTruthy();
  });

  it("offers both clearing operations for a reopened disposition", () => {
    renderScreen(buildCarriedDisposition("reopened-disposition"));
    expect(screen.getByText("Flagged region changed again")).toBeTruthy();
    expect(screen.getByTestId("attention-action-address-risk")).toBeTruthy();
    fireEvent.click(screen.getByTestId("attention-action-dismiss-risk"));
    expect(screen.getByText("Dismiss flag")).toBeTruthy();
  });

  it("offers both clearing operations for carried evidence that is gone", () => {
    renderScreen(buildCarriedDisposition("missing-evidence"));
    expect(screen.getByText("Evidence for this decision is gone")).toBeTruthy();
    expect(screen.getByTestId("attention-action-dismiss-risk")).toBeTruthy();
    fireEvent.click(screen.getByTestId("attention-action-address-risk"));
    expect(screen.getByText("Address risk with evidence")).toBeTruthy();
  });
});
