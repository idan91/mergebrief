// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BranchPair } from "./BranchPair";

afterEach(cleanup);

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
}

describe("BranchPair", () => {
  it("renders nothing when both refs are absent", () => {
    render(<BranchPair />);
    expect(screen.queryByTestId("branch-pair")).toBeNull();
  });

  it("renders the head name and copy without an arrow", () => {
    render(<BranchPair headRef="feature/thing" />);
    const pair = screen.getByTestId("branch-pair");
    expect(pair?.textContent).toContain("feature/thing");
    expect(pair.querySelector('[data-icon="arrow-up"]')).toBeNull();
    expect(pair?.getAttribute("role")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Copy head branch" }),
    ).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Copy base branch" }),
    ).toBeNull();
  });

  it("renders base then head with two copy controls", () => {
    render(<BranchPair baseRef="main" headRef="feature/thing" />);
    const pair = screen.getByTestId("branch-pair");
    expect(pair?.getAttribute("role")).toBe("group");
    expect(pair?.getAttribute("aria-label")).toBe("feature/thing into main");
    expect(pair?.textContent).toContain("main");
    expect(pair?.textContent).toContain("feature/thing");
    expect(
      screen.getByRole("button", { name: "Copy base branch" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Copy head branch" }),
    ).toBeTruthy();
    const arrow = pair.querySelector('[data-icon="arrow-up"]');
    expect(arrow?.getAttribute("aria-hidden")).toBe("true");
    expect(arrow?.getAttribute("data-rotation")).toBe("270");
  });

  it("copy buttons write the bare branch name", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    mockClipboard(writeText);
    render(<BranchPair baseRef="main" headRef="feature/thing" />);
    fireEvent.click(screen.getByRole("button", { name: "Copy base branch" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("main"));
    fireEvent.click(screen.getByRole("button", { name: "Copy head branch" }));
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith("feature/thing"),
    );
  });
});
