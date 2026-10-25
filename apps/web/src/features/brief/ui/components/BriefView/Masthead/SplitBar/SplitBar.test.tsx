// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { computeConcernShares } from "../utils";
import { SplitBar } from ".";

describe("SplitBar", () => {
  it("draws one meter segment and one legend entry per share", () => {
    const shares = computeConcernShares(
      [
        { concern: "implementation", added: 40, deleted: 10 },
        { concern: "test", added: 30, deleted: 0 },
      ],
      { added: 20, deleted: 0 },
    );
    const { container } = render(<SplitBar shares={shares} />);

    const segments = container.querySelectorAll("[aria-hidden] i");
    expect(
      [...segments].map((node) => node.getAttribute("data-concern")),
    ).toEqual(["implementation", "test", null]);
    const legend = within(screen.getByRole("list")).getAllByRole("listitem");
    expect(legend.map((item) => item.textContent)).toEqual([
      "Implementation50%",
      "Test30%",
      "Unattributed20%",
    ]);
  });

  it("renders nothing below two concerns", () => {
    const shares = computeConcernShares(
      [{ concern: "implementation", added: 40, deleted: 10 }],
      { added: 20, deleted: 0 },
    );
    const { container } = render(<SplitBar shares={shares} />);

    expect(container.innerHTML).toBe("");
  });
});
