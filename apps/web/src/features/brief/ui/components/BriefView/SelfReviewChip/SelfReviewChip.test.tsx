// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../../i18n/I18nProvider";
import { SelfReviewChip } from ".";

function renderChip() {
  render(
    <I18nProvider>
      <SelfReviewChip />
    </I18nProvider>,
  );
}

describe("SelfReviewChip", () => {
  it("renders the non-dismissible self-review chip with its tooltip", () => {
    renderChip();
    const chip = screen.getByText("Self-review — your draft");
    expect(chip).toBeTruthy();
    // Non-dismissible: the chip carries no close affordance.
    expect(
      chip
        .closest("[data-self-review-chip]")
        ?.querySelector("button[aria-label*='close' i]"),
    ).toBeNull();
    const info = screen.getByRole("button", { name: "About self-review" });
    const tooltipId = info.getAttribute("aria-describedby");
    expect(tooltipId).toBeTruthy();
    const tooltip = document.getElementById(tooltipId ?? "");
    expect(tooltip?.getAttribute("role")).toBe("tooltip");
    expect(tooltip?.textContent).toBe(
      "You're viewing your own draft PR. Review submission and the receipt unlock once it's marked ready for review.",
    );
  });

  it("Escape dismisses a focused tooltip without leaking the key", () => {
    renderChip();
    const info = screen.getByRole("button", { name: "About self-review" });
    const wrap = info.parentElement;
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(false);

    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    fireEvent.focus(info);
    fireEvent.keyDown(info, { key: "Escape" });
    // Dismissed - and the key never reached the page (focus-mode Escape).
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);
    expect(onWindowKeyDown).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onWindowKeyDown);

    // Blur re-arms it for the next focus/hover…
    fireEvent.blur(info);
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(false);

    // …and so does the pointer leaving after an Escape while hovering.
    if (wrap) {
      fireEvent.mouseEnter(wrap);
    }
    fireEvent.keyDown(document, { key: "Escape" });
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);
    if (wrap) {
      fireEvent.mouseLeave(wrap);
    }
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(false);
  });

  it("Escape-dismissal sticks while EITHER hover or focus is still active", () => {
    renderChip();
    const info = screen.getByRole("button", { name: "About self-review" });
    const wrap = info.parentElement;

    // Both channels active, then Escape.
    if (wrap) {
      fireEvent.mouseEnter(wrap);
    }
    fireEvent.focus(info);
    fireEvent.keyDown(info, { key: "Escape" });
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);

    // Pointer drifts away while focus remains: must STAY dismissed.
    if (wrap) {
      fireEvent.mouseLeave(wrap);
    }
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);

    // The inverse: re-hover, then blur while the pointer stays - still
    // dismissed (focus left, hover holds).
    if (wrap) {
      fireEvent.mouseEnter(wrap);
    }
    fireEvent.blur(info);
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);

    // Only when BOTH channels go idle does the tooltip re-arm.
    if (wrap) {
      fireEvent.mouseLeave(wrap);
    }
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(false);
  });

  it("Escape dismisses a hovered tooltip without leaking the key", () => {
    renderChip();
    const info = screen.getByRole("button", { name: "About self-review" });
    const wrap = info.parentElement;
    expect(document.activeElement).toBe(document.body);

    const onWindowKeyDown = vi.fn();
    window.addEventListener("keydown", onWindowKeyDown);
    // Pointer hover only - focus never moves off <body>.
    if (wrap) {
      fireEvent.mouseEnter(wrap);
    }
    fireEvent.keyDown(document.body, { key: "Escape" });
    // Dismissed, key claimed: it must NOT fall through to the page's
    // window-level shortcut listener (which would exit focus mode).
    expect(wrap?.hasAttribute("data-tooltip-dismissed")).toBe(true);
    expect(onWindowKeyDown).not.toHaveBeenCalled();

    // Once the tooltip is gone, the claim is released: a second Escape
    // reaches the page as usual.
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(onWindowKeyDown).toHaveBeenCalledTimes(1);
    window.removeEventListener("keydown", onWindowKeyDown);
  });
});
