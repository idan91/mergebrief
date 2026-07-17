// @vitest-environment jsdom
// The attribute-keyed jump-rail (ADR 0032 #11): collapsed unless a floor
// attribute fired; chips cycle through carrying groups in story order.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AttributeRail } from "../../viewModel";
import { AttributeJumpRail } from "./AttributeJumpRail";

afterEach(cleanup);

const RAIL: AttributeRail = {
  entries: [
    { attr: "touches-auth", source: "built-in", floor: true, groupIds: ["g2"] },
    {
      attr: "touches-billing",
      source: "repo-policy",
      floor: false,
      groupIds: ["g1", "g3"],
    },
  ],
  floorFired: true,
};

describe("AttributeJumpRail", () => {
  it("renders nothing with no entries", () => {
    const { container } = render(
      <AttributeJumpRail
        jumpToGroup={() => {}}
        rail={{ entries: [], floorFired: false }}
      />,
    );
    expect(container.querySelector("[data-attribute-jump-rail]")).toBeNull();
  });

  it("defaults open when a floor attribute fired, collapsed otherwise", () => {
    render(<AttributeJumpRail jumpToGroup={() => {}} rail={RAIL} />);
    expect(
      screen.getByRole("button", { name: /Risk attributes/ }),
    ).toHaveProperty("ariaExpanded", "true");
    cleanup();
    render(
      <AttributeJumpRail
        jumpToGroup={() => {}}
        rail={{ ...RAIL, floorFired: false }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Risk attributes/ }),
    ).toHaveProperty("ariaExpanded", "false");
  });

  it("click cycles through carrying groups in story order", () => {
    const jump = vi.fn();
    render(<AttributeJumpRail jumpToGroup={jump} rail={RAIL} />);
    const billing = screen.getByRole("button", { name: /touches-billing/ });
    fireEvent.click(billing);
    fireEvent.click(billing);
    fireEvent.click(billing);
    expect(jump.mock.calls.map(([id]) => id)).toEqual(["g1", "g3", "g1"]);
  });

  it("floor chip is pinned first and repo chips carry the source variant", () => {
    render(<AttributeJumpRail jumpToGroup={() => {}} rail={RAIL} />);
    const chips = screen.getAllByRole("button").slice(1); // skip the toggle
    expect(chips[0]?.textContent).toContain("touches-auth");
    expect(
      screen
        .getByText(/touches-billing/)
        .closest("[data-source]")
        ?.getAttribute("data-source"),
    ).toBe("repo-policy");
  });
});
