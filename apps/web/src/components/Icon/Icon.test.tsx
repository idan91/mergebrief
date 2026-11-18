// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Icon } from ".";
import { IconNames, IconRotations, IconSizes } from "./types";

function findIcon(): SVGSVGElement {
  const icon = document.querySelector("svg");
  if (icon === null) {
    throw new Error("no icon rendered");
  }
  return icon;
}

describe("Icon", () => {
  it("is hidden from assistive technology without a label", () => {
    render(<Icon name={IconNames.COPY} />);

    const icon = findIcon();
    expect(icon.getAttribute("aria-hidden")).toBe("true");
    expect(icon.getAttribute("role")).toBeNull();
    expect(icon.getAttribute("focusable")).toBe("false");
  });

  it("takes an image role and its label when it stands alone", () => {
    render(<Icon label="Open on GitHub" name={IconNames.GITHUB_LOGO} />);

    const icon = screen.getByRole("img", { name: "Open on GitHub" });
    expect(icon.getAttribute("aria-hidden")).toBeNull();
  });

  it("draws at the size it is given, 16 by default", () => {
    render(<Icon name={IconNames.CHECK} size={IconSizes.SM} />);
    expect(findIcon().getAttribute("width")).toBe("12");
    expect(findIcon().getAttribute("height")).toBe("12");

    cleanup();
    render(<Icon name={IconNames.CHECK} />);
    expect(findIcon().getAttribute("width")).toBe("16");
  });

  it("names its rotation for the stylesheet and none at rest", () => {
    render(
      <Icon name={IconNames.CARET_DOWN} rotation={IconRotations.QUARTER} />,
    );
    expect(findIcon().getAttribute("data-rotation")).toBe("90");

    cleanup();
    render(<Icon name={IconNames.CARET_DOWN} />);
    expect(findIcon().getAttribute("data-rotation")).toBeNull();
  });

  it("keeps the set's viewBox so every glyph shares the grid", () => {
    render(<Icon name={IconNames.WARNING} />);

    expect(findIcon().getAttribute("viewBox")).toBe("0 0 256 256");
  });
});
