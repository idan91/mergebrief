// @vitest-environment jsdom
import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommentBody } from ".";
import { COMMENT_CLAMP_PX } from "./consts";

function stubScrollHeight(height: number): void {
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(
    height,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CommentBody", () => {
  it("clamps a tall comment behind Show full comment", () => {
    stubScrollHeight(COMMENT_CLAMP_PX * 3);
    render(<CommentBody>tall</CommentBody>);

    const toggle = screen.getByRole("button", { name: "Show full comment" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.getByTestId("comment-body").dataset["state"]).toBe("clamped");

    fireEvent.click(toggle);

    expect(
      screen
        .getByRole("button", { name: "Show less" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(screen.getByTestId("comment-body").dataset["state"]).toBe(
      "expanded",
    );
  });

  it("leaves a short comment whole, with no toggle", () => {
    stubScrollHeight(COMMENT_CLAMP_PX - 1);
    render(<CommentBody>short</CommentBody>);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByTestId("comment-body").dataset["state"]).toBe("whole");
  });

  it("opens a clamped comment when focus moves to a link inside it", () => {
    stubScrollHeight(COMMENT_CLAMP_PX * 3);
    render(
      <CommentBody>
        <a href="#below">below the clamp</a>
      </CommentBody>,
    );

    act(() => {
      screen.getByRole("link").focus();
    });

    expect(screen.getByTestId("comment-body").dataset["state"]).toBe(
      "expanded",
    );
  });
});
