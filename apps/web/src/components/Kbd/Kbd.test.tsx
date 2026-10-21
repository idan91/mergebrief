// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Kbd, KbdGroup, KbdSizes } from ".";

describe("Kbd", () => {
  it("renders a kbd element at the list size by default", () => {
    render(<Kbd>Esc</Kbd>);
    const cap = screen.getByText("Esc");
    expect(cap.tagName).toBe("KBD");
    expect(cap.getAttribute("data-size")).toBe(KbdSizes.MD);
  });
});

describe("KbdGroup", () => {
  it("joins chord members with a plus", () => {
    render(
      <KbdGroup>
        <Kbd>Shift</Kbd>
        <Kbd>J</Kbd>
      </KbdGroup>,
    );
    const caps = screen
      .getAllByText(/Shift|J/)
      .filter((el) => el.tagName === "KBD");
    expect(caps.map((cap) => cap.textContent)).toEqual(["Shift", "J"]);
    expect(caps[0]?.parentElement?.textContent).toBe("Shift+J");
  });
});
