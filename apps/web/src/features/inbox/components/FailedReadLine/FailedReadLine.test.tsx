// @vitest-environment jsdom
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { ApiErrorCodes } from "../../../../data/apiFetch";
import { FailedReadLine } from ".";

const SERVER_LINE =
  "This list could not be updated. The server did not answer.";

function readSpoken(): string {
  return screen.getByRole("status").textContent ?? "";
}

describe("FailedReadLine", () => {
  it("shows nothing and says nothing while the list is current", () => {
    render(<FailedReadLine code={undefined} onRetry={vi.fn()} />);

    expect(screen.queryByTestId("failed-read")).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
    expect(readSpoken()).toBe("");
  });

  it("names GitHub for its wire code and the server for any other", () => {
    const { rerender } = render(
      <FailedReadLine
        code={ApiErrorCodes.GITHUB_UNAVAILABLE}
        onRetry={vi.fn()}
      />,
    );
    expect(readSpoken()).toBe(
      "This list could not be updated. GitHub did not answer.",
    );

    rerender(
      <FailedReadLine code={ApiErrorCodes.INTERNAL_ERROR} onRetry={vi.fn()} />,
    );
    expect(readSpoken()).toBe(SERVER_LINE);
    expect(screen.getByTestId("failed-read").textContent).toContain(
      SERVER_LINE,
    );
  });

  it("speaks the line again when a retry fails again", async () => {
    render(
      <FailedReadLine
        code={ApiErrorCodes.INTERNAL_ERROR}
        onRetry={vi.fn(async () => false)}
      />,
    );
    const spokenBefore = screen.getByRole("status").firstElementChild;

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    });

    const spokenAfter = screen.getByRole("status").firstElementChild;
    expect(spokenAfter).not.toBe(spokenBefore);
    expect(readSpoken()).toBe(SERVER_LINE);
    expect(
      screen
        .getByRole("button", { name: "Try again" })
        .getAttribute("aria-busy"),
    ).not.toBe("true");
  });

  it("asks again once and holds the button while the read runs", async () => {
    let finish: (arrived: boolean) => void = () => {};
    const onRetry = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    render(
      <FailedReadLine code={ApiErrorCodes.INTERNAL_ERROR} onRetry={onRetry} />,
    );
    const button = screen.getByRole("button", { name: "Try again" });

    fireEvent.click(button);
    expect(button.getAttribute("aria-busy")).toBe("true");
    fireEvent.click(button);
    expect(onRetry).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(true);
    });
    expect(button.getAttribute("aria-busy")).not.toBe("true");
  });

  it("hands focus to main once a retry brings the list back", async () => {
    render(
      <>
        <main id="main-content" tabIndex={-1} />
        <FailedReadLine
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
  });
});
