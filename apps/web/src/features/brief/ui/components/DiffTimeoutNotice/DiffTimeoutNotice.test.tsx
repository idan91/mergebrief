// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DiffTimeoutNotice } from ".";

afterEach(cleanup);

const releaseFocus = vi.fn();

describe("DiffTimeoutNotice", () => {
  it("alerts the timeout sentence and retries on the button", () => {
    const retry = vi.fn();
    render(
      <DiffTimeoutNotice
        retry={{ pending: false, failureCount: 1, retry, releaseFocus }}
      />,
    );

    expect(screen.getByRole("alert").textContent).toBe(
      "GitHub took too long to render this diff. Try again in a minute.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it("holds the button and says so while the retry runs", () => {
    const retry = vi.fn();
    render(
      <DiffTimeoutNotice
        retry={{ pending: true, failureCount: 1, retry, releaseFocus }}
      />,
    );
    const button = screen.getByRole("button", { name: "Trying again…" });

    fireEvent.click(button);

    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(retry).not.toHaveBeenCalled();
  });

  it("re-mounts the alert on a new failure and keeps focus on the button", () => {
    const retry = vi.fn();
    const { rerender } = render(
      <DiffTimeoutNotice
        retry={{ pending: false, failureCount: 1, retry, releaseFocus }}
      />,
    );
    const firstAlert = screen.getByRole("alert");
    const button = screen.getByRole("button", { name: "Try again" });
    button.focus();

    rerender(
      <DiffTimeoutNotice
        retry={{ pending: false, failureCount: 2, retry, releaseFocus }}
      />,
    );

    expect(screen.getByRole("alert")).not.toBe(firstAlert);
    expect(document.activeElement).toBe(button);
  });

  it("releases focus when it leaves the page holding it", () => {
    const release = vi.fn();
    const retry = { pending: false, failureCount: 1, retry: vi.fn() };
    const { unmount } = render(
      <DiffTimeoutNotice retry={{ ...retry, releaseFocus: release }} />,
    );
    screen.getByRole("button", { name: "Try again" }).focus();

    unmount();

    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases nothing when it leaves without focus", () => {
    const release = vi.fn();
    const retry = { pending: false, failureCount: 1, retry: vi.fn() };
    const { unmount } = render(
      <DiffTimeoutNotice retry={{ ...retry, releaseFocus: release }} />,
    );

    unmount();

    expect(release).not.toHaveBeenCalled();
  });
});
