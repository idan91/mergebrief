// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { FailureBlock } from ".";

afterEach(cleanup);

describe("FailureBlock", () => {
  it("names the failure as an alert and retries on the one button", () => {
    const onRetry = vi.fn();
    render(
      <FailureBlock
        detail="GitHub did not answer."
        heading={<h1>Briefs could not be loaded</h1>}
        retryLabel="Try again"
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "GitHub did not answer.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("holds the button while a retry is in flight", () => {
    const onRetry = vi.fn();
    render(
      <FailureBlock
        detail="The server did not answer."
        heading={<h1>Briefs could not be loaded</h1>}
        pending
        retryLabel="Try again"
        onRetry={onRetry}
      />,
    );
    const button = screen.getByRole("button", { name: "Try again" });

    fireEvent.click(button);

    expect(button.getAttribute("aria-busy")).toBe("true");
    expect(onRetry).not.toHaveBeenCalled();
  });
});
