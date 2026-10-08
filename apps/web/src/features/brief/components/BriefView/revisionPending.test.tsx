// @vitest-environment jsdom
// The revision-pending treatment: while a revision navigation outlasts the
// pending delay, the stale content stays visible but goes non-interactive,
// dim (data-pending) + inert + aria-busy on the content region ONLY. The
// sticky header (revision controls, lenses) must stay live so the reviewer
// can keep stepping; a small decorative spinner rides beside the controls.
// Fast loads (shorter than the appearance delay) must show nothing at all.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { renderStageInRouter } from "../../../../test/router";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

import { I18nProvider } from "../../../../i18n/I18nProvider";
import { BriefView } from ".";
import {
  PENDING_APPEAR_MS,
  PENDING_MIN_HOLD_MS,
} from "../BriefScreen/useDelayedPending";
import { briefFixture } from "@web/features/brief/fixtures";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

async function renderWithPending(revisionPending: boolean) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = (pending: boolean) => (
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <BriefView
          artifacts={[]}
          brief={briefFixture}
          briefId="revision-pending-test"
          searchParams={{}}
          revisionPending={pending}
        />
      </QueryClientProvider>
    </I18nProvider>
  );
  const stage = await renderStageInRouter(view(revisionPending), [
    "/briefs/$briefId/summary-preview",
  ]);
  return {
    rerenderWith: (pending: boolean) => stage.update(view(pending)),
  };
}

function main(): HTMLElement {
  // Two landmarks render (the screen's content region and the summary-preview
  // drawer's), the treatment targets the one with the content id.
  const region = document.getElementById("main-content");
  if (region === null) {
    throw new Error("main-content not rendered");
  }
  return region;
}

describe("revision-pending treatment", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps the content fully live when nothing is pending", async () => {
    await renderWithPending(false);
    expect(main().hasAttribute("inert")).toBe(false);
    expect(main().hasAttribute("data-pending")).toBe(false);
    expect(main().getAttribute("aria-busy")).toBeNull();
  });

  it("shows nothing for a load faster than the appearance delay", async () => {
    const { rerenderWith } = await renderWithPending(true);
    act(() => {
      vi.advanceTimersByTime(PENDING_APPEAR_MS - 1);
    });
    rerenderWith(false);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(main().hasAttribute("inert")).toBe(false);
    expect(main().hasAttribute("data-pending")).toBe(false);
  });

  it("dims and inerts ONLY the content region after the delay", async () => {
    await renderWithPending(true);
    act(() => {
      vi.advanceTimersByTime(PENDING_APPEAR_MS);
    });
    expect(main().hasAttribute("inert")).toBe(true);
    expect(main().hasAttribute("data-pending")).toBe(true);
    expect(main().getAttribute("aria-busy")).toBe("true");

    // The sticky header stays operable: none of its controls sit inside an
    // inert ancestor. Submit lives in the header on the reviewer view.
    const submit = screen.getByRole("button", { name: "Submit" });
    expect(submit.closest("[inert]")).toBeNull();
  });

  it("stands the window-level keyboard shortcuts down while pending", async () => {
    // `inert` does not stop a window keydown listener, the shortcut layer
    // must disable itself, or `?`/j/k would act on the stale brief.
    await renderWithPending(true);
    act(() => {
      vi.advanceTimersByTime(PENDING_APPEAR_MS);
    });
    fireEvent.keyDown(window, { key: "?" });
    expect(
      screen.getByText("Keyboard shortcuts").closest("[data-state]"),
    ).toMatchObject({ dataset: { state: "closed" } });
  });

  it("keeps the shortcuts live when nothing is pending", async () => {
    await renderWithPending(false);
    fireEvent.keyDown(window, { key: "?" });
    expect(
      screen.getByText("Keyboard shortcuts").closest("[data-state]"),
    ).toMatchObject({ dataset: { state: "open" } });
  });

  it("holds the treatment for the minimum once shown, then releases", async () => {
    const { rerenderWith } = await renderWithPending(true);
    act(() => {
      vi.advanceTimersByTime(PENDING_APPEAR_MS);
    });
    expect(main().hasAttribute("inert")).toBe(true);

    rerenderWith(false);
    act(() => {
      vi.advanceTimersByTime(PENDING_MIN_HOLD_MS - 1);
    });
    expect(main().hasAttribute("inert")).toBe(true);
    act(() => {
      vi.advanceTimersByTime(1);
    });
    expect(main().hasAttribute("inert")).toBe(false);
    expect(main().hasAttribute("data-pending")).toBe(false);
    expect(main().getAttribute("aria-busy")).toBeNull();
  });
});
