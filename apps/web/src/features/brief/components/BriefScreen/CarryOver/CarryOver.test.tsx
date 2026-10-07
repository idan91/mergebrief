// @vitest-environment jsdom
// The carry-over row's four states, the span it always states, and the
// attention list's clearing affordances, driven through the real screen,
// because the list is what replaces the row and both are one region.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { renderInRouter } from "../../../../../test/router";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../../../../i18n/I18nProvider";
import type {
  ReviewSessionPayload,
  SessionReadSource,
} from "@web/features/review/session";
import { makeSessionReadDriver } from "@web/features/review/utils";
import { BriefView } from "../../BriefView";
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

async function renderScreen(
  session: ReviewSessionPayload | undefined,
  sessionReads?: SessionReadSource,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return await renderInRouter(
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <BriefView
          artifacts={[]}
          brief={briefFixture}
          briefId="carry-over-test"
          searchParams={{}}
          session={session}
          sessionReads={sessionReads}
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

function getRowStatus(): HTMLElement {
  return within(screen.getByTestId("carry-over-row")).getByRole("status");
}

describe("carry-over row", () => {
  it("renders no row at all on a first-ever session", async () => {
    await renderScreen(buildPayload({ carriedFrom: null }));
    expect(screen.queryByTestId("carry-over-row")).toBeNull();
  });

  it("renders the row from a session read that lands later", async () => {
    const reads = makeSessionReadDriver();
    await renderScreen(buildPayload({ carriedFrom: null }), reads.source);
    expect(screen.queryByTestId("carry-over-row")).toBeNull();

    act(() => {
      reads.startRead();
      reads.landRead(buildPayload({}));
    });

    expect(getRowText()).toContain("Your review carried forward · 4 items");
  });

  it("renders no row when a previous session carried nothing", async () => {
    await renderScreen(
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

  it("states the receipt work, count, span, and nothing to re-look at", async () => {
    await renderScreen(buildPayload({}));
    expect(getRowText()).toContain("Your review carried forward · 4 items");
    expect(getRowText()).toContain("a84c1de → abcdef1");
    expect(getRowText()).toContain("nothing needs a re-look");
    expect(screen.queryByTestId("attention-item")).toBeNull();
  });

  it("counts the revisions when more than one push happened", async () => {
    await renderScreen(
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

  it("suppresses the count when both span ends are the same SHA", async () => {
    await renderScreen(
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

  it("states the clean receipt as the box's single visible line", async () => {
    await renderScreen(buildPayload({}));
    const row = screen.getByTestId("carry-over-row");
    const status = getRowStatus();
    expect(row.querySelectorAll("p")).toHaveLength(1);
    expect(row.getAttribute("data-state")).toBe("clean");
    expect(status.textContent).toContain("Your review carried forward");
  });

  it("heads the pending list with its verdict", async () => {
    await renderScreen(buildOrphanedDraft());
    const status = getRowStatus();
    const verdict = "1 item from your last review needs a re-look";
    expect(
      screen.getByTestId("carry-over-row").getAttribute("data-state"),
    ).toBe("pending");
    expect(status.textContent).toBe(verdict);
    expect(getRowText()).not.toContain("Your review carried forward");
    expect(screen.getByRole("list", { name: verdict })).toBeTruthy();
    expect(screen.getAllByTestId("attention-item")).toHaveLength(1);
    expect(screen.getByText("Draft comment lost its lines")).toBeTruthy();
    // Not a notification: nothing dismisses the row.
    expect(screen.queryByRole("button", { name: /dismiss$/i })).toBeNull();
  });

  it("announces the receipt in the same live region once the last clears", async () => {
    await renderScreen(buildOrphanedDraft());
    const status = getRowStatus();
    fireEvent.click(
      screen.getByTestId("attention-action-delete-draft-comment"),
    );
    expect(screen.queryByTestId("attention-item")).toBeNull();
    expect(getRowStatus()).toBe(status);
    expect(status.textContent).toContain("nothing needs a re-look");
    expect(
      screen.getByTestId("carry-over-row").getAttribute("data-state"),
    ).toBe("clean");
  });

  it("arms placement for the re-anchor operation the item names", async () => {
    await renderScreen(buildOrphanedDraft());
    fireEvent.click(getReanchorControl());
    // The next picked row places it; until then the item stands.
    expect(screen.getAllByTestId("attention-item")).toHaveLength(1);
    const gutter = document.querySelector(
      "[data-commentable] [data-comment-anchor]",
    );
    expect(gutter).toBeTruthy();
    fireEvent.mouseDown(gutter as Element);
    fireEvent.mouseUp(gutter as Element);
    // Placement, not a composer: the draft moved instead of a new one opening.
    expect(screen.queryByPlaceholderText("Leave a comment")).toBeNull();
    expect(screen.queryByTestId("attention-item")).toBeNull();
  });

  it("disarms placement when the re-anchor control is pressed again", async () => {
    await renderScreen(buildOrphanedDraft());
    fireEvent.click(getReanchorControl());
    expect(getReanchorControl().textContent).toBe("Cancel re-anchor");
    fireEvent.click(getReanchorControl());
    expect(getReanchorControl().textContent).toBe("Re-anchor");
    // Disarmed: the next picked row opens a composer, as it always would.
    const gutter = document.querySelector(
      "[data-commentable] [data-comment-anchor]",
    );
    fireEvent.mouseDown(gutter as Element);
    fireEvent.mouseUp(gutter as Element);
    expect(screen.getByPlaceholderText("Leave a comment")).toBeTruthy();
  });

  it("reads the re-anchor control as an action, never a pressed toggle", async () => {
    await renderScreen(buildOrphanedDraft());
    fireEvent.click(getReanchorControl());
    expect(getReanchorControl().hasAttribute("aria-pressed")).toBe(false);
  });

  it("highlights the armed item and drops the inline hint", async () => {
    await renderScreen(buildOrphanedDraft());
    const item = screen.getByTestId("attention-item");
    expect(item.hasAttribute("data-armed")).toBe(false);
    fireEvent.click(getReanchorControl());
    expect(item.hasAttribute("data-armed")).toBe(true);
    expect(item.textContent).not.toContain("Pick the lines");
  });

  it("shows the mode banner while armed and hides it on cancel", async () => {
    await renderScreen(buildOrphanedDraft());
    expect(screen.queryByTestId("reanchor-banner")).toBeNull();
    fireEvent.click(getReanchorControl());
    const banner = screen.getByTestId("reanchor-banner");
    expect(banner.textContent).toContain("src/leak.ts:+10");
    fireEvent.click(
      within(banner).getByRole("button", { name: "Cancel re-anchor" }),
    );
    expect(screen.queryByTestId("reanchor-banner")).toBeNull();
    expect(getReanchorControl().textContent).toBe("Re-anchor");
  });

  it("cancels re-anchoring on Escape from anywhere on the page", async () => {
    await renderScreen(buildOrphanedDraft());
    fireEvent.click(getReanchorControl());
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(screen.queryByTestId("reanchor-banner")).toBeNull();
    expect(
      screen.getByTestId("attention-item").hasAttribute("data-armed"),
    ).toBe(false);
  });

  it("returns focus to the content when the banner's Cancel is pressed", async () => {
    await renderScreen(buildOrphanedDraft());
    fireEvent.click(getReanchorControl());
    const cancel = within(screen.getByTestId("reanchor-banner")).getByRole(
      "button",
      { name: "Cancel re-anchor" },
    );
    cancel.focus();
    fireEvent.click(cancel);
    expect(document.activeElement?.id).toBe("main-content");
  });

  it("ends the mode when the armed draft is deleted", async () => {
    await renderScreen(buildOrphanedDraft());
    fireEvent.click(getReanchorControl());
    fireEvent.click(
      screen.getByTestId("attention-action-delete-draft-comment"),
    );
    expect(screen.queryByTestId("reanchor-banner")).toBeNull();
    expect(document.querySelector("[data-pick]")).toBeNull();
  });

  it("stacks the re-anchor banner after the focus pill", async () => {
    await renderScreen(buildOrphanedDraft());
    fireEvent.click(getReanchorControl());
    fireEvent.keyDown(window, { key: "z" });
    const focusIndicator = await screen.findByTestId("focus-indicator");
    const reanchorBanner = screen.getByTestId("reanchor-banner");
    const follows =
      focusIndicator.compareDocumentPosition(reanchorBanner) &
      Node.DOCUMENT_POSITION_FOLLOWING;
    expect(follows).toBeTruthy();
  });

  it("hides the carry-over bar in focus mode", async () => {
    await renderScreen(buildOrphanedDraft());
    expect(getReanchorControl()).toBeTruthy();
    fireEvent.keyDown(window, { key: "z" });
    await screen.findByTestId("focus-indicator");
    expect(screen.queryByTestId("carry-over-row")).toBeNull();
  });

  it("marks the draft's file rows pickable while armed", async () => {
    await renderScreen(buildOrphanedDraft());
    expect(document.querySelector("[data-pick]")).toBeNull();
    fireEvent.click(getReanchorControl());
    const draftFileCard = document.getElementById("chunk-a");
    expect(
      draftFileCard?.querySelector('tr[data-pick="available"]'),
    ).toBeTruthy();
    expect(
      draftFileCard?.querySelector('[data-pick="unavailable"]'),
    ).toBeNull();
    fireEvent.click(getReanchorControl());
    expect(document.querySelector("[data-pick]")).toBeNull();
  });

  it("offers both clearing operations for a reopened disposition", async () => {
    await renderScreen(buildCarriedDisposition("reopened-disposition"));
    expect(
      screen.getByText("Flagged code changed after your decision"),
    ).toBeTruthy();
    expect(screen.getByTestId("attention-action-address-risk")).toBeTruthy();
    fireEvent.click(screen.getByTestId("attention-action-dismiss-risk"));
    expect(screen.getByText("Dismiss flag")).toBeTruthy();
  });

  it("offers both clearing operations for carried evidence that is gone", async () => {
    await renderScreen(buildCarriedDisposition("missing-evidence"));
    expect(screen.getByText("Evidence for your decision is gone")).toBeTruthy();
    expect(screen.getByTestId("attention-action-dismiss-risk")).toBeTruthy();
    fireEvent.click(screen.getByTestId("attention-action-address-risk"));
    expect(screen.getByText("Address risk with evidence")).toBeTruthy();
  });

  it("says what clears the item and ties the hint to its actions", async () => {
    await renderScreen(buildCarriedDisposition("reopened-disposition"));
    const hint = screen.getByText(
      "Re-check the new code, then address the flag again or dismiss it.",
    );
    const address = screen.getByTestId("attention-action-address-risk");
    expect(address.getAttribute("aria-describedby")).toBe(hint.id);
  });

  it("shows a flag's attribute apart from the file it jumps to", async () => {
    await renderScreen(buildCarriedDisposition("reopened-disposition"));
    const item = screen.getByTestId("attention-item");
    expect(within(item).getByText(FLAG_ATTRIBUTE)).toBeTruthy();
    expect(screen.getByTestId("attention-jump").textContent).toBe(FLAG_FILE);
  });
});
