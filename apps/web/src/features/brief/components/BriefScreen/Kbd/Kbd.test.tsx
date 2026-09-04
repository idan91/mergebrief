// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Kbd, KbdSizes } from "./Kbd";

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
