// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CopyButton } from "./CopyButton";

afterEach(cleanup);

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
    expect(button.getAttribute("title")).toBe("a/b.ts");
    fireEvent.click(button);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("a/b.ts"));
    expect(onCopy).toHaveBeenCalledWith("a/b.ts");
    expect(screen.getByText("Copied")).toBeTruthy();
  });

  it("announces a failed copy and does not notify onCopy", async () => {
    mockClipboard(vi.fn().mockRejectedValue(new Error("denied")));
    const onCopy = vi.fn();
    render(<CopyButton label="Copy file path" onCopy={onCopy} text="a/b.ts" />);
    fireEvent.click(screen.getByRole("button", { name: /copy file path/i }));
    expect(await screen.findByText("Copy failed")).toBeTruthy();
    expect(onCopy).not.toHaveBeenCalled();
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
        vi.advanceTimersByTime(1700);
      });
      expect(screen.queryByText("Copied")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
