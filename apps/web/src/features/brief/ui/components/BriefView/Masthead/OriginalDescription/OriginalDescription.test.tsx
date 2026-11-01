// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { OriginalDescription } from ".";

describe("OriginalDescription", () => {
  it("counts the words in the closed row and opens to the text", () => {
    render(<OriginalDescription description="Fix the leak in parsing" />);

    const toggle = screen.getByRole("button", {
      name: /original description/i,
    });
    expect(toggle.textContent).toContain("5 words, as the author wrote it");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Fix the leak in parsing")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Fix the leak in parsing")).toBeTruthy();
  });

  it("puts no description image in the page until opened", () => {
    const { container } = render(
      <OriginalDescription description="![Shot](https://example.com/shot.png)" />,
    );

    expect(container.querySelector("img")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: /original description/i }),
    );

    expect(screen.getByRole("img", { name: "Shot" })).toBeTruthy();
  });

  it("marks the mentions the author wrote", () => {
    render(<OriginalDescription description="Pairs with @cara on this" />);

    fireEvent.click(
      screen.getByRole("button", { name: /original description/i }),
    );

    expect(screen.getByTestId("mention").textContent).toBe("@cara");
  });

  it("marks a blank description empty and says so when opened", () => {
    render(<OriginalDescription description="  " />);

    const toggle = screen.getByRole("button", {
      name: /original description/i,
    });
    expect(toggle.textContent).toContain("Empty");
    fireEvent.click(toggle);
    expect(screen.getByText("No PR description provided.")).toBeTruthy();
  });
});
