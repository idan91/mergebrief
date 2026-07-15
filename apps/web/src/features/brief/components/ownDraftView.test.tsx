// @vitest-environment jsdom
// The own-draft Brief view (BRIEF-43, ADR 0031): one Brief view for every
// viewer; the author surface is state-derived affordances inside it. This
// suite pins the state's contract through the rendered screen:
//   - the state is visibly labeled (self-review chip) and non-dismissible;
//   - submit-review machinery + receipt are HIDDEN, not broken — nothing
//     dangling that references submit;
//   - risk flags are a read-only mirror (no disposition controls);
//   - chunk tracking and comment drafting stay available (role-free);
//   - when the PrView flips draft=false under a live session (mark-ready or
//     ready-elsewhere), the affordances vanish and the reviewer view appears.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { OwnDraftPlan } from "./BriefPage/BriefPage";
import { BriefView } from "./BriefPage/BriefPage";
import { briefFixture } from "../fixtures";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

const CHIP_COPY = "Self-review — your draft";

/** The Modal wrapper's open/closed state for the overlay containing `text`. */
function overlayState(text: string): string | undefined | null {
  return screen
    .getByText(text)
    .closest("[data-state]")
    ?.getAttribute("data-state");
}

function renderBriefView(ownDraft: OwnDraftPlan | undefined) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (plan: OwnDraftPlan | undefined) => (
    <QueryClientProvider client={queryClient}>
      <BriefView
        artifacts={[]}
        brief={briefFixture}
        briefId="own-draft-test"
        searchParams={{}}
        ownDraft={plan}
      />
    </QueryClientProvider>
  );
  const utils = render(view(ownDraft));
  return {
    rerenderWith: (plan: OwnDraftPlan | undefined) =>
      utils.rerender(view(plan)),
  };
}

describe("own-draft Brief view (BRIEF-43)", () => {
  it("labels the state with the chip and swaps the terminal-action slot", () => {
    renderBriefView({ markReady: vi.fn() });
    expect(screen.getByText(CHIP_COPY)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Mark ready for review" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Receipt" })).toBeNull();
  });

  it("renders no own-draft affordances on a plain reviewer view", () => {
    renderBriefView(undefined);
    expect(screen.queryByText(CHIP_COPY)).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Mark ready for review" }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Receipt" })).toBeTruthy();
  });

  it("hides the submit machinery and the receipt entirely — nothing dangling", () => {
    renderBriefView({ markReady: vi.fn() });
    // The receipt drawer and its Submit button are not in the DOM at all.
    expect(screen.queryByRole("button", { name: /submit review/i })).toBeNull();
    expect(screen.queryByText(/review receipt/i)).toBeNull();
    // The pre-submit ("Before the receipt") modal is unmounted too.
    expect(screen.queryByText(/before the receipt/i)).toBeNull();
    // No menu path back into submit: Summary preview is gone.
    fireEvent.click(screen.getByRole("button", { name: /more actions/i }));
    expect(
      screen.queryByRole("menuitem", { name: /summary preview/i }),
    ).toBeNull();
  });

  it("renders risk flags as a read-only mirror — visible, no disposition controls", () => {
    renderBriefView({ markReady: vi.fn() });
    // The flags stay fully visible (the mirror)…
    expect(screen.getAllByText("no-tests").length).toBeGreaterThan(0);
    // …but every disposition control is gone.
    expect(screen.queryByRole("button", { name: "Addressed" })).toBeNull();
    expect(screen.queryByRole("button", { name: /^dismiss/i })).toBeNull();
    expect(
      screen.queryByRole("button", { name: /address selected/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("checkbox", { name: /select .* flag/i }),
    ).toBeNull();
  });

  it("keeps chunk tracking available (local session state is role-free)", () => {
    renderBriefView({ markReady: vi.fn() });
    expect(screen.getAllByText("Viewed").length).toBeGreaterThan(0);
  });

  it("progress reaches 100% from chunk read-through alone (flags excluded in own-draft)", () => {
    renderBriefView({ markReady: vi.fn() });
    // View every chunk — with dispositions unreachable, chunks are the whole
    // denominator; counting flags would cap this below 100% forever.
    for (const viewed of screen.getAllByText("Viewed")) {
      const input = viewed.closest("label")?.querySelector("input");
      if (input) fireEvent.click(input);
    }
    const bar = document.querySelector('header div[style*="--progress-width"]');
    expect(bar?.getAttribute("style")).toContain("100%");
  });

  it("vanishes the affordances when draft flips under a live session", () => {
    const { rerenderWith } = renderBriefView({ markReady: vi.fn() });
    expect(screen.getByText(CHIP_COPY)).toBeTruthy();
    // The refreshed PrView (draft=false) turns the plan undefined — the same
    // view swaps to reviewer affordances without remounting anything else.
    rerenderWith(undefined);
    expect(screen.queryByText(CHIP_COPY)).toBeNull();
    expect(screen.getByRole("button", { name: "Receipt" })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Mark ready for review" }),
    ).toBeNull();
  });

  it("rescues focus from an unmounting overlay onto the terminal-slot CTA, with an announcement", async () => {
    const { rerenderWith } = renderBriefView(undefined);
    // Open the pre-submit overlay: the Modal claims focus on open.
    fireEvent.click(screen.getByRole("button", { name: "Receipt" }));
    expect(document.activeElement === document.body).toBe(false);

    // The PR converts to draft on GitHub while focus lives in the overlay:
    // the overlay unmounts (no blur fires) — focus must land on the
    // terminal-slot CTA instead of dropping to <body> silently…
    rerenderWith({ markReady: vi.fn() });
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Mark ready for review" }),
    );
    // …and the live region explains why the screen just changed.
    await waitFor(() =>
      expect(screen.getByText(/converted to a draft/i)).toBeTruthy(),
    );
  });

  it("flip INTO own-draft under an open overlay: state clears, shortcuts revive, no resurrection", () => {
    const { rerenderWith } = renderBriefView(undefined);
    // Open the pre-submit overlay on the reviewer view (Receipt CTA).
    fireEvent.click(screen.getByRole("button", { name: "Receipt" }));
    expect(overlayState("Before the receipt")).toBe("open");

    // The PR converts to draft on GitHub under the open overlay.
    rerenderWith({ markReady: vi.fn() });
    expect(screen.queryByText("Before the receipt")).toBeNull();
    // The open flag was RESET, not merely unmounted: page shortcuts are not
    // stuck disabled — "?" opens the shortcuts modal.
    fireEvent.keyDown(window, { key: "?" });
    expect(overlayState("Keyboard shortcuts")).toBe("open");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(overlayState("Keyboard shortcuts")).toBe("closed");

    // Marked ready again: the pre-submit overlay must not resurrect.
    rerenderWith(undefined);
    expect(overlayState("Before the receipt")).toBe("closed");
  });
});
