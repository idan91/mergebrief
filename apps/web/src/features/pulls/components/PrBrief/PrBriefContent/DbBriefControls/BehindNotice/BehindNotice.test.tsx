// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { BehindNotice } from ".";

describe("BehindNotice", () => {
  it("names the new commits and regenerates on the one button", () => {
    const onRegenerate = vi.fn();
    render(
      <BehindNotice
        pending={false}
        queued={false}
        onRegenerate={onRegenerate}
      />,
    );

    expect(screen.getByText("New commits")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });

  it("keeps the button, inert and renamed, once a generation is on its way", () => {
    const onRegenerate = vi.fn();
    render(<BehindNotice pending={false} queued onRegenerate={onRegenerate} />);
    const button = screen.getByRole("button", { name: "Regenerate queued" });

    fireEvent.click(button);

    expect(button.getAttribute("aria-disabled")).toBe("true");
    expect(onRegenerate).not.toHaveBeenCalled();
  });

  it("states how long a queued draft regeneration can take", () => {
    render(
      <BehindNotice
        pending={false}
        queued
        queuedNotice="Draft mode, up to about 15 minutes."
        onRegenerate={vi.fn()}
      />,
    );

    expect(
      screen.getByText("Draft mode, up to about 15 minutes."),
    ).toBeTruthy();
  });

  it("offers no button without a repository name and shows the refusal", () => {
    render(
      <BehindNotice
        failure="Generating this brief failed"
        pending={false}
        queued={false}
      />,
    );

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("Generating this brief failed")).toBeTruthy();
  });

  it("hands focus to the main landmark when it leaves holding it", () => {
    render(<main id="main-content" tabIndex={-1} />);
    const { unmount } = render(
      <BehindNotice pending={false} queued={false} onRegenerate={vi.fn()} />,
    );
    screen.getByRole("button", { name: "Regenerate" }).focus();

    unmount();

    expect(document.activeElement?.id).toBe("main-content");
  });

  it("leaves focus alone when it never held it", () => {
    render(<main id="main-content" tabIndex={-1} />);
    const { unmount } = render(
      <BehindNotice pending={false} queued={false} onRegenerate={vi.fn()} />,
    );

    unmount();

    expect(document.activeElement).toBe(document.body);
  });
});
