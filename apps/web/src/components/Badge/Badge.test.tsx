// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Badge, BadgeColors } from ".";

afterEach(cleanup);

describe("Badge", () => {
  it("renders its label in a neutral tint by default", () => {
    render(<Badge>core</Badge>);

    const badge = screen.getByText("core");
    expect(badge.getAttribute("data-color")).toBe("neutral");
    expect(badge.textContent).toBe("core");
  });

  it("names its colour and carries the dataset it is handed", () => {
    render(
      <Badge color={BadgeColors.POSITIVE} dataset={{ status: "added" }}>
        added
      </Badge>,
    );

    const badge = screen.getByText("added");
    expect(badge.getAttribute("data-color")).toBe("positive");
    expect(badge.getAttribute("data-status")).toBe("added");
  });

  it("is the link itself when handed an href", () => {
    render(<Badge href="https://tracker.example/T-1">Ticket</Badge>);

    const link = screen.getByRole("link", { name: /^Ticket/ });
    expect(link.getAttribute("href")).toBe("https://tracker.example/T-1");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("data-color")).toBe("neutral");
  });

  it("passes a title through for the pointer", () => {
    render(<Badge title="Implementation">impl</Badge>);

    expect(screen.getByText("impl").getAttribute("title")).toBe(
      "Implementation",
    );
  });
});
