// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Kbd, KbdGroup, KbdSizes } from ".";

afterEach(cleanup);

describe("Kbd", () => {
  it("renders a kbd element at the list size by default", () => {
    render(<Kbd>Esc</Kbd>);
    const cap = screen.getByText("Esc");
    expect(cap.tagName).toBe("KBD");
    expect(cap.getAttribute("data-size")).toBe(KbdSizes.MD);
  });

  it("takes the sentence size and a caller class", () => {
    render(
      <Kbd className="extra" size={KbdSizes.SM}>
        J
      </Kbd>,
    );
    const cap = screen.getByText("J");
    expect(cap.getAttribute("data-size")).toBe(KbdSizes.SM);
    expect(cap.className).toContain("extra");
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
