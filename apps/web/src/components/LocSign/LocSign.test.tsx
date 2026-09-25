// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { LocSign, LocSigns } from ".";

afterEach(cleanup);

describe("LocSign", () => {
  it("renders an added count with a plus prefix", () => {
    render(<LocSign sign={LocSigns.ADD} count={12} />);
    const node = screen.getByText("+12");
    expect(node.getAttribute("data-sign")).toBe(LocSigns.ADD);
  });

  it("renders a deleted count with a minus prefix", () => {
    render(<LocSign sign={LocSigns.DEL} count={3} />);
    const node = screen.getByText("−3");
    expect(node.getAttribute("data-sign")).toBe(LocSigns.DEL);
  });
});
