// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { CopyButton } from ".";
import { COPY_FEEDBACK_RESET_MS } from "./consts";

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

describe("CopyButton", () => {
  it("copies the text, notifies onCopy, and announces success", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    const onCopy = vi.fn();
    render(<CopyButton label="Copy file path" onCopy={onCopy} text="a/b.ts" />);
    const button = screen.getByRole("button", { name: /copy file path/i });
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("a/b.ts"));
    expect(onCopy).toHaveBeenCalledWith("a/b.ts");
    expect(screen.getByText("Copied")).toBeTruthy();
  });

  it("resolves a text function at click time and shows the icon it is given", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    let current = "first";
    render(<CopyButton icon="link" label="Copy link" text={() => current} />);
    const button = screen.getByRole("button", { name: /copy link/i });
    expect(button.getAttribute("title")).toBeNull();
    expect(button.querySelector('[data-icon="link"]')).not.toBeNull();
    current = "second";
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("second"));
  });

  it("shows the content it is given, then the check while copied", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    render(<CopyButton content="42" label="Copy link to line 42" text="x" />);
    const button = screen.getByRole("button", {
      name: /copy link to line 42/i,
    });
    expect(button.textContent).toContain("42");
    expect(button.getAttribute("data-width")).toBe("auto");
    expect(button.querySelector("[data-icon]")).toBeNull();
    fireEvent.click(button);
    await waitFor(() =>
      expect(button.getAttribute("data-state")).toBe("copied"),
    );
    expect(button.querySelector('[data-icon="check"]')).not.toBeNull();
    expect(button.textContent).not.toContain("42");
  });

  it("announces a failed copy and does not notify onCopy", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    const onCopy = vi.fn();
    render(<CopyButton label="Copy file path" onCopy={onCopy} text="a/b.ts" />);
    fireEvent.click(screen.getByRole("button", { name: /copy file path/i }));
    expect(await screen.findByText("Copy failed")).toBeTruthy();
    expect(onCopy).not.toHaveBeenCalled();
  });

  it("names the outcome in its callout while the feedback shows", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    render(<CopyButton label="Copy link to this chunk" text="x" />);
    const button = screen.getByRole("button", {
      name: "Copy link to this chunk",
    });
    vi.spyOn(button, "matches").mockImplementation(
      (selector) => selector === ":focus-visible",
    );
    fireEvent.focus(button);
    expect(screen.getByRole("tooltip").textContent).toBe(
      "Copy link to this chunk",
    );

    fireEvent.click(button);

    await waitFor(() =>
      expect(screen.getByRole("tooltip").textContent).toBe("Copy failed"),
    );
    expect(button.getAttribute("aria-label")).toBe("Copy link to this chunk");
  });

  it("resets the feedback after a moment", async () => {
    vi.useFakeTimers();
    try {
      mockClipboard(vi.fn().mockResolvedValue(undefined));
      render(<CopyButton label="Copy" text="x" />);
      fireEvent.click(screen.getByRole("button", { name: /copy/i }));
      // Flush the async copy under fake timers.
      await vi.waitFor(() => expect(screen.getByText("Copied")).toBeTruthy());
      act(() => {
        vi.advanceTimersByTime(COPY_FEEDBACK_RESET_MS);
      });
      expect(screen.queryByText("Copied")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
