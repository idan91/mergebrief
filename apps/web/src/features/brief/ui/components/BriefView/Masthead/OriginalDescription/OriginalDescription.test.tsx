// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { UNSERVED_GITHUB_IMAGE_URL } from "@web/test/attachments";
import { OriginalDescription } from ".";

describe("OriginalDescription", () => {
  afterEach(cleanup);

  it("counts the words in the closed row and opens to the text", () => {
    render(<OriginalDescription description="Fix the leak in parsing" />);

    const toggle = screen.getByRole("button", {
      name: /original description/i,
    });
    expect(toggle.textContent).toContain("5 words, as the author wrote it");
    expect(toggle.querySelector("b")?.textContent).toBe("5");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Fix the leak in parsing")).toBeNull();

    fireEvent.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Fix the leak in parsing")).toBeTruthy();
  });

  it("parses the html the author wrote", () => {
    render(
      <OriginalDescription description='<img alt="Description image" src="https://github.com/user-attachments/assets/3e5dffc4-bd05-4a01-98e8-1c519ba4cf00" />' />,
    );

    fireEvent.click(
      screen.getByRole("button", { name: /original description/i }),
    );

    expect(screen.getByRole("img", { name: "Description image" })).toBeTruthy();
  });

  it("puts no description image in the page until opened", () => {
    const { container } = render(
      <OriginalDescription
        description={`![Shot](${UNSERVED_GITHUB_IMAGE_URL})`}
      />,
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
