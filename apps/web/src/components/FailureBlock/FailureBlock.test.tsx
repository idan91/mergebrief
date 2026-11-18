// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { FailureBlock } from ".";
import { FailureBlockScales } from "./types";

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

  it("reads at page size unless told it sits inside a region", () => {
    render(
      <FailureBlock
        detail="GitHub did not answer."
        heading={<h1>Briefs could not be loaded</h1>}
        retryLabel="Try again"
        onRetry={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Try again" });

    expect(screen.getByRole("alert").getAttribute("data-scale")).toBe("page");
    expect(button.getAttribute("data-size")).toBe("md");
  });

  it("reads at the size of the content around it inside a region", () => {
    render(
      <FailureBlock
        detail="The rest of the page still works."
        heading={<h4>This diff could not be shown</h4>}
        retryLabel="Try again"
        scale={FailureBlockScales.REGION}
        onRetry={vi.fn()}
      />,
    );
    const button = screen.getByRole("button", { name: "Try again" });

    expect(screen.getByRole("alert").getAttribute("data-scale")).toBe("region");
    expect(button.getAttribute("data-size")).toBe("sm");
  });
});
