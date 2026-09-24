// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Callout } from "./Callout";

afterEach(cleanup);

beforeEach(() => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({ matches: true, addEventListener: vi.fn() })),
  );
});

function renderCallout(props: { compact?: boolean; fit?: boolean } = {}) {
  const anchor = document.createElement("button");
  document.body.append(anchor);
  return render(
    <Callout anchor={anchor} onClose={() => undefined} {...props}>
      <Callout.Title>New since your review</Callout.Title>
      <Callout.Body>Two commits landed after you last read it.</Callout.Body>
    </Callout>,
  );
}

describe("Callout", () => {
  it("renders as a tooltip holding its title and body", () => {
    renderCallout();

    const callout = screen.getByRole("tooltip");
    expect(callout.textContent).toContain("New since your review");
    expect(callout.textContent).toContain("Two commits landed");
  });

  it("marks the compact and fit densities for the stylesheet", () => {
    renderCallout({ compact: true, fit: true });

    const callout = screen.getByRole("tooltip");
    expect(callout.hasAttribute("data-compact")).toBe(true);
    expect(callout.hasAttribute("data-fit")).toBe(true);
  });
});
