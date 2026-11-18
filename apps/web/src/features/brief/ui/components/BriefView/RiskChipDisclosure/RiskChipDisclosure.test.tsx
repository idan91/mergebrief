// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { RiskChipDisclosure } from ".";

function renderDisclosure(): HTMLElement {
  render(
    <RiskChipDisclosure detail={<span>Detail text</span>}>
      <span>Risk chip</span>
    </RiskChipDisclosure>,
  );
  return screen.getByRole("button", { name: "Risk chip" });
}

describe("RiskChipDisclosure", () => {
  afterEach(cleanup);

  it("closes on Escape with focus left on the chip", () => {
    const chip = renderDisclosure();
    chip.focus();
    fireEvent.click(chip);
    expect(chip.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(chip, { key: "Escape" });

    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Detail text")).toBeNull();
    expect(document.activeElement).toBe(chip);
  });

  it("keeps the Escape that closed it from page shortcuts", () => {
    const onPageKey = vi.fn();
    window.addEventListener("keydown", onPageKey);
    onTestFinished(() => window.removeEventListener("keydown", onPageKey));
    const chip = renderDisclosure();
    fireEvent.pointerEnter(chip, { pointerType: "mouse" });
    expect(chip.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(chip.getAttribute("aria-expanded")).toBe("false");
    expect(onPageKey).not.toHaveBeenCalled();
  });
});
