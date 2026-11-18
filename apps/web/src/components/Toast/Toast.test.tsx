// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TOAST_ACTION_VISIBLE_MS, TOAST_VISIBLE_MS } from "./consts";
import { Toast, type ToastProps } from "./index";
import { ToastHoldSources } from "./types";
import { useToast, type ToastState } from "./useToast";

function settleAnnouncement() {
  act(() => {
    vi.advanceTimersByTime(20);
  });
}

describe("Toast", () => {
  afterEach(cleanup);

  it("keeps the live regions mounted while hidden", () => {
    render(<Toast message="" testId="toast" />);

    const regions = screen.getAllByRole("status");
    expect(regions.map((region) => region.textContent)).toEqual(["", ""]);
    expect(screen.getByTestId("toast").dataset["state"]).toBe("hidden");
  });

  it("runs its action from a labelled button", () => {
    const run = vi.fn();
    render(<Toast action={{ label: "Undo", run }} message="Archived" />);

    fireEvent.click(screen.getByRole("button", { name: "Undo" }));

    expect(run).toHaveBeenCalledOnce();
  });

  it("keeps a disabled action focusable and never runs it", () => {
    const run = vi.fn();
    render(
      <Toast
        actionDisabled
        action={{ label: "Undo", run }}
        message="Archived"
      />,
    );
    const undo = screen.getByRole("button", { name: "Undo" });

    undo.focus();
    fireEvent.click(undo);

    expect(undo.getAttribute("aria-disabled")).toBe("true");
    expect(document.activeElement).toBe(undo);
    expect(run).not.toHaveBeenCalled();
  });

  it("offers no action once the line is gone", () => {
    render(<Toast action={{ label: "Undo", run: vi.fn() }} message="" />);

    expect(screen.queryByRole("button", { name: "Undo" })).toBeNull();
  });

  it("names pointer and focus apart when they hold the line", () => {
    const onHold = vi.fn();
    const onRelease = vi.fn();
    render(
      <Toast
        action={{ label: "Undo", run: vi.fn() }}
        message="Archived"
        testId="toast"
        onHold={onHold}
        onRelease={onRelease}
      />,
    );
    const toast = screen.getByTestId("toast");

    fireEvent.pointerEnter(toast);
    fireEvent.focus(screen.getByRole("button", { name: "Undo" }));
    fireEvent.pointerLeave(toast);

    expect(onHold.mock.calls).toEqual([
      [ToastHoldSources.POINTER],
      [ToastHoldSources.FOCUS],
    ]);
    expect(onRelease.mock.calls).toEqual([[ToastHoldSources.POINTER]]);
  });

  it("holds the line while its action waits on a request", () => {
    const onHold = vi.fn();
    const onRelease = vi.fn();
    const action = { label: "Undo", run: vi.fn() };
    const { rerender } = render(
      <Toast
        actionDisabled
        action={action}
        message="Archived"
        onHold={onHold}
        onRelease={onRelease}
      />,
    );
    expect(onHold.mock.calls).toEqual([[ToastHoldSources.PENDING]]);

    rerender(
      <Toast
        action={action}
        message="Archived"
        onHold={onHold}
        onRelease={onRelease}
      />,
    );

    expect(onRelease.mock.calls).toEqual([[ToastHoldSources.PENDING]]);
  });

  it("never holds a line with no action for a running request", () => {
    const onHold = vi.fn();
    render(<Toast actionDisabled message="Link copied" onHold={onHold} />);

    expect(onHold).not.toHaveBeenCalled();
  });

  it("releases the focus hold when its focused action unmounts", () => {
    const onRelease = vi.fn();
    const action = { label: "Undo", run: vi.fn() };
    const { rerender } = render(
      <Toast action={action} message="Archived" onRelease={onRelease} />,
    );
    screen.getByRole("button", { name: "Undo" }).focus();

    rerender(<Toast message="Restored" onRelease={onRelease} />);

    expect(onRelease).toHaveBeenCalledWith(ToastHoldSources.FOCUS);
  });
});

describe("Toast focus hand-off", () => {
  afterEach(cleanup);

  const action = { label: "Undo", run: vi.fn() };
  const leaves: readonly (readonly [string, ToastProps])[] = [
    ["a line with no action replaces it", { message: "Restored" }],
    ["the line expires", { message: "" }],
    ["its action is removed", { message: "Archived" }],
    ["the toast hides", { action, message: "Archived", shown: false }],
  ];

  function focusHeading(): void {
    screen.getByRole("heading", { name: "Inbox" }).focus();
  }

  function renderBesideHeading(props: ToastProps) {
    return (
      <>
        <h2 tabIndex={-1}>Inbox</h2>
        <Toast {...props} onActionLeft={focusHeading} />
      </>
    );
  }

  it.each(leaves)("hands focus on when %s", (_case, props) => {
    const { rerender } = render(
      renderBesideHeading({ action, message: "Archived" }),
    );
    screen.getByRole("button", { name: "Undo" }).focus();

    rerender(renderBesideHeading(props));

    expect(document.activeElement).toBe(
      screen.getByRole("heading", { name: "Inbox" }),
    );
  });

  it("leaves focus alone when an unfocused action goes", () => {
    const onActionLeft = vi.fn();
    const { rerender } = render(
      <Toast action={action} message="Archived" onActionLeft={onActionLeft} />,
    );

    rerender(<Toast message="Restored" onActionLeft={onActionLeft} />);

    expect(onActionLeft).not.toHaveBeenCalled();
  });
});

describe("useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers({
      toFake: [
        "setTimeout",
        "clearTimeout",
        "requestAnimationFrame",
        "cancelAnimationFrame",
      ],
    });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("clears the line after its visible time", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.show("Link copied"));
    settleAnnouncement();
    expect(result.current.message).toBe("Link copied");

    act(() => {
      vi.advanceTimersByTime(TOAST_VISIBLE_MS);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("");
  });

  it("gives a line with an action longer to reach it", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.show("Archived", { label: "Undo", run: vi.fn() }));
    settleAnnouncement();
    act(() => {
      vi.advanceTimersByTime(TOAST_VISIBLE_MS);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("Archived");

    act(() => {
      vi.advanceTimersByTime(TOAST_ACTION_VISIBLE_MS - TOAST_VISIBLE_MS);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("");
    expect(result.current.action).toBeUndefined();
  });

  it("holds the line while the pointer or focus is on it", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.show("Archived"));
    settleAnnouncement();
    act(() => result.current.hold(ToastHoldSources.POINTER));
    act(() => {
      vi.advanceTimersByTime(TOAST_VISIBLE_MS * 3);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("Archived");

    act(() => result.current.release(ToastHoldSources.POINTER));
    act(() => {
      vi.advanceTimersByTime(TOAST_VISIBLE_MS);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("");
  });

  it("keeps the line while focus stays after the pointer leaves", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.show("Archived", { label: "Undo", run: vi.fn() }));
    settleAnnouncement();
    act(() => result.current.hold(ToastHoldSources.POINTER));
    act(() => result.current.hold(ToastHoldSources.FOCUS));
    act(() => result.current.release(ToastHoldSources.POINTER));
    act(() => {
      vi.advanceTimersByTime(TOAST_ACTION_VISIBLE_MS * 2);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("Archived");

    act(() => result.current.release(ToastHoldSources.FOCUS));
    act(() => {
      vi.advanceTimersByTime(TOAST_ACTION_VISIBLE_MS);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("");
  });

  it("keeps a held line in place when the next result lands", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.show("Archived"));
    settleAnnouncement();
    act(() => result.current.hold(ToastHoldSources.POINTER));
    act(() => result.current.show("Restored"));
    settleAnnouncement();
    act(() => {
      vi.advanceTimersByTime(TOAST_VISIBLE_MS * 3);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("Restored");

    act(() => result.current.release(ToastHoldSources.POINTER));
    act(() => {
      vi.advanceTimersByTime(TOAST_VISIBLE_MS);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("");
  });

  it("ignores a release from a source that never held the line", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.show("Archived"));
    settleAnnouncement();
    act(() => {
      vi.advanceTimersByTime(TOAST_VISIBLE_MS / 2);
    });
    act(() => result.current.release(ToastHoldSources.FOCUS));
    act(() => {
      vi.advanceTimersByTime(TOAST_VISIBLE_MS / 2);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("");
  });

  it("shows an outcome over the action that started its run", () => {
    const { result } = renderHook(() => useToast());
    const undo = { label: "Undo", run: vi.fn() };

    act(() => result.current.show("Archived", undo));
    settleAnnouncement();
    act(() => result.current.showOutcome("Unarchived", undo));
    settleAnnouncement();

    expect(result.current.message).toBe("Unarchived");
    expect(result.current.action).toBeUndefined();
    expect(result.current.aside).toBe("");
  });

  it("only speaks an outcome while a newer action holds the line", () => {
    const { result } = renderHook(() => useToast());
    const olderUndo = { label: "Undo", run: vi.fn() };
    const newerUndo = { label: "Undo", run: vi.fn() };

    act(() => result.current.show("Archived 2", olderUndo));
    settleAnnouncement();
    act(() => result.current.show("Archived 1", newerUndo));
    settleAnnouncement();
    act(() => result.current.showOutcome("Unarchived 2", olderUndo));
    settleAnnouncement();

    expect(result.current.message).toBe("Archived 1");
    expect(result.current.action).toBe(newerUndo);
    expect(result.current.aside).toBe("Unarchived 2");
  });

  it("clears the spoken aside when the next line shows", () => {
    const { result } = renderHook(() => useToast());
    const olderUndo = { label: "Undo", run: vi.fn() };

    act(() => result.current.show("Archived 2", olderUndo));
    act(() =>
      result.current.show("Archived 1", { label: "Undo", run: vi.fn() }),
    );
    act(() => result.current.showOutcome("Unarchived 2", olderUndo));
    settleAnnouncement();
    expect(result.current.aside).toBe("Unarchived 2");

    act(() => result.current.show("Unarchived 1"));
    settleAnnouncement();

    expect(result.current.aside).toBe("");
  });

  it("shows an outcome once the newer action's line is gone", () => {
    const { result } = renderHook(() => useToast());
    const olderUndo = { label: "Undo", run: vi.fn() };

    act(() =>
      result.current.show("Archived 1", { label: "Undo", run: vi.fn() }),
    );
    settleAnnouncement();
    act(() => {
      vi.advanceTimersByTime(TOAST_ACTION_VISIBLE_MS);
    });
    settleAnnouncement();
    act(() => result.current.showOutcome("Unarchived 2", olderUndo));
    settleAnnouncement();

    expect(result.current.message).toBe("Unarchived 2");
    expect(result.current.aside).toBe("");
  });

  it("shows an outcome with an action once the newer line leaves", () => {
    const { result } = renderHook(() => useToast());
    const olderUndo = { label: "Undo", run: vi.fn() };
    const newerUndo = { label: "Undo", run: vi.fn() };
    const retry = { label: "Undo", run: vi.fn() };

    act(() => result.current.show("Archived 2", olderUndo));
    act(() => result.current.show("Archived 1", newerUndo));
    act(() => result.current.showOutcome("Unarchive failed", olderUndo, retry));
    settleAnnouncement();
    expect(result.current.message).toBe("Archived 1");
    expect(result.current.action).toBe(newerUndo);
    expect(result.current.aside).toBe("Unarchive failed");

    act(() => {
      vi.advanceTimersByTime(TOAST_ACTION_VISIBLE_MS);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("Unarchive failed");
    expect(result.current.action).toBe(retry);
    expect(result.current.aside).toBe("");

    act(() => {
      vi.advanceTimersByTime(TOAST_ACTION_VISIBLE_MS);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("");
  });

  it("keeps a waiting outcome behind each newer line in turn", () => {
    const { result } = renderHook(() => useToast());
    const olderUndo = { label: "Undo", run: vi.fn() };
    const retry = { label: "Undo", run: vi.fn() };

    act(() => result.current.show("Archived 3", olderUndo));
    act(() =>
      result.current.show("Archived 2", { label: "Undo", run: vi.fn() }),
    );
    act(() => result.current.showOutcome("Unarchive failed", olderUndo, retry));
    act(() =>
      result.current.show("Archived 1", { label: "Undo", run: vi.fn() }),
    );
    act(() => {
      vi.advanceTimersByTime(TOAST_ACTION_VISIBLE_MS / 2);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("Archived 1");

    act(() => {
      vi.advanceTimersByTime(TOAST_ACTION_VISIBLE_MS / 2);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("Unarchive failed");
    expect(result.current.action).toBe(retry);
  });

  it("shows waiting outcomes oldest first", () => {
    const { result } = renderHook(() => useToast());
    const firstUndo = { label: "Undo", run: vi.fn() };
    const secondUndo = { label: "Undo", run: vi.fn() };
    const firstRetry = { label: "Undo", run: vi.fn() };
    const secondRetry = { label: "Undo", run: vi.fn() };

    act(() => result.current.show("Archived 3", firstUndo));
    act(() => result.current.show("Archived 2", secondUndo));
    act(() =>
      result.current.show("Archived 1", { label: "Undo", run: vi.fn() }),
    );
    act(() => result.current.showOutcome("Failed 3", firstUndo, firstRetry));
    act(() => result.current.showOutcome("Failed 2", secondUndo, secondRetry));
    act(() => {
      vi.advanceTimersByTime(TOAST_ACTION_VISIBLE_MS);
    });
    settleAnnouncement();
    expect(result.current.action).toBe(firstRetry);

    act(() => {
      vi.advanceTimersByTime(TOAST_ACTION_VISIBLE_MS);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("Failed 2");
    expect(result.current.action).toBe(secondRetry);
  });

  it("shows a waiting outcome after the newer action's own outcome", () => {
    const { result } = renderHook(() => useToast());
    const olderUndo = { label: "Undo", run: vi.fn() };
    const newerUndo = { label: "Undo", run: vi.fn() };
    const retry = { label: "Undo", run: vi.fn() };

    act(() => result.current.show("Archived 2", olderUndo));
    act(() => result.current.show("Archived 1", newerUndo));
    act(() => result.current.showOutcome("Unarchive failed", olderUndo, retry));
    act(() => result.current.showOutcome("Back in your Inbox", newerUndo));
    settleAnnouncement();
    expect(result.current.message).toBe("Back in your Inbox");
    expect(result.current.action).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(TOAST_VISIBLE_MS);
    });
    settleAnnouncement();
    expect(result.current.message).toBe("Unarchive failed");
    expect(result.current.action).toBe(retry);
  });

  it.each([ToastHoldSources.POINTER, ToastHoldSources.FOCUS])(
    "keeps a waiting outcome back while %s holds the newer line",
    (source) => {
      const { result } = renderHook(() => useToast());
      const olderUndo = { label: "Undo", run: vi.fn() };
      const newerUndo = { label: "Undo", run: vi.fn() };
      const retry = { label: "Undo", run: vi.fn() };

      act(() => result.current.show("Archived 2", olderUndo));
      act(() => result.current.show("Archived 1", newerUndo));
      act(() => result.current.hold(source));
      act(() =>
        result.current.showOutcome("Unarchive failed", olderUndo, retry),
      );
      act(() => {
        vi.advanceTimersByTime(TOAST_ACTION_VISIBLE_MS * 3);
      });
      settleAnnouncement();
      expect(result.current.action).toBe(newerUndo);

      act(() => result.current.release(source));
      act(() => {
        vi.advanceTimersByTime(TOAST_ACTION_VISIBLE_MS);
      });
      settleAnnouncement();
      expect(result.current.message).toBe("Unarchive failed");
      expect(result.current.action).toBe(retry);
    },
  );

  it("never shows a spoken outcome that offers no action", () => {
    const { result } = renderHook(() => useToast());
    const olderUndo = { label: "Undo", run: vi.fn() };

    act(() => result.current.show("Archived 2", olderUndo));
    act(() =>
      result.current.show("Archived 1", { label: "Undo", run: vi.fn() }),
    );
    act(() => result.current.showOutcome("Unarchived 2", olderUndo));
    act(() => {
      vi.advanceTimersByTime(TOAST_ACTION_VISIBLE_MS);
    });
    settleAnnouncement();

    expect(result.current.message).toBe("");
    expect(result.current.action).toBeUndefined();
  });

  it("keeps a focused action in place when the next line replaces it", () => {
    let toast: ToastState | undefined;
    function ToastHarness() {
      toast = useToast();
      return (
        <Toast
          action={toast.action}
          message={toast.message}
          shown={toast.shown}
          testId="toast"
          onHold={toast.hold}
          onRelease={toast.release}
        />
      );
    }
    render(<ToastHarness />);
    act(() => toast?.show("Archived 1", { label: "Undo", run: vi.fn() }));
    settleAnnouncement();
    const first = screen.getByRole("button", { name: "Undo" });
    act(() => first.focus());

    act(() => toast?.show("Archived 2", { label: "Undo", run: vi.fn() }));

    expect(screen.getByTestId("toast").getAttribute("data-state")).toBe(
      "visible",
    );
    expect(screen.getByRole("button", { name: "Undo" })).toBe(first);
    settleAnnouncement();
    expect(document.activeElement).toBe(first);
    expect(toast?.message).toBe("Archived 2");
  });
});
