// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GhostMark } from ".";

afterEach(cleanup);

describe("GhostMark", () => {
  it("draws the mark hidden from assistive technology", () => {
    render(<GhostMark />);

    const mark = screen.getByTestId("ghost-mark");
    expect(mark.tagName.toLowerCase()).toBe("svg");
    expect(mark.getAttribute("aria-hidden")).toBe("true");
    expect(mark.getAttribute("focusable")).toBe("false");
  });
});
