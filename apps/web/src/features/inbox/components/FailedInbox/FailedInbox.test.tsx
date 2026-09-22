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

import { ApiErrorCodes } from "../../../../data/apiFetch";
import { FailedInbox } from "./FailedInbox";

afterEach(cleanup);

describe("FailedInbox", () => {
  it("names GitHub for its wire code and the server for any other", () => {
    render(
      <FailedInbox
        code={ApiErrorCodes.GITHUB_UNAVAILABLE}
        onRetry={vi.fn(async () => false)}
      />,
    );
    expect(screen.getByText(/GitHub did not answer/)).toBeTruthy();
    cleanup();

    render(
      <FailedInbox
        code={ApiErrorCodes.INTERNAL_ERROR}
        onRetry={vi.fn(async () => false)}
      />,
    );
    expect(screen.getByText(/The server did not answer/)).toBeTruthy();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: "Briefs could not be loaded",
      }),
    ).toBeTruthy();
  });

  it("a retry that fails again is announced and keeps the button", async () => {
    render(
      <FailedInbox
        code={ApiErrorCodes.INTERNAL_ERROR}
        onRetry={vi.fn(async () => false)}
      />,
    );
    const button = screen.getByRole("button", { name: "Try again" });

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "The server did not answer. Try again in a moment.",
      );
    });
    expect(button.getAttribute("aria-busy")).not.toBe("true");
  });

  it("a retry that throws frees the button and is announced", async () => {
    render(
      <FailedInbox
        code={ApiErrorCodes.INTERNAL_ERROR}
        onRetry={vi.fn(async () => {
          throw new Error("aborted");
        })}
      />,
    );
    const button = screen.getByRole("button", { name: "Try again" });

    await act(async () => {
      fireEvent.click(button);
    });

    await waitFor(() => {
      expect(screen.getByRole("status").textContent).toBe(
        "The server did not answer. Try again in a moment.",
      );
    });
    expect(button.getAttribute("aria-busy")).not.toBe("true");
  });

  it("a retry that brings the list back hands focus to main", async () => {
    render(
      <>
        <main id="main-content" tabIndex={-1} />
        <FailedInbox
          code={ApiErrorCodes.INTERNAL_ERROR}
          onRetry={vi.fn(async () => true)}
        />
      </>,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });

    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole("main"));
    });
    expect(screen.getByRole("status").textContent).toBe("");
  });
});
