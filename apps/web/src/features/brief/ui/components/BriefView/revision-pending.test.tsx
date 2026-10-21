// @vitest-environment jsdom
// The revision-pending treatment: while a revision navigation outlasts the
// pending delay, the stale content stays visible but goes non-interactive,
// dim (data-pending) + inert + aria-busy on the content region ONLY. The
// sticky header (revision, scope and comparison controls) must stay live so the reviewer
// can keep stepping; a small decorative spinner rides beside the controls.
// Fast loads (shorter than the appearance delay) must show nothing at all.
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PENDING_APPEAR_MS } from "../../hooks/useDelayedPending";
import { mountBriefView } from "@web/features/brief/test-utils";

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
});

function main(): HTMLElement {
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
    await mountBriefView({ revisionPending: false });
    expect(main().hasAttribute("inert")).toBe(false);
    expect(main().hasAttribute("data-pending")).toBe(false);
    expect(main().getAttribute("aria-busy")).toBeNull();
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
    expect(submit.closest("[inert]")).toBeNull();
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
