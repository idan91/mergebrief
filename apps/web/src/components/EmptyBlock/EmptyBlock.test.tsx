// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Button } from "../Button/Button";
import { EmptyBlock } from "./EmptyBlock";

afterEach(cleanup);

describe("EmptyBlock", () => {
  it("renders the heading it is handed, the detail and the action", () => {
    render(
      <EmptyBlock
        action={<Button type="button">Clear</Button>}
        detail="Merged rows are hidden."
        heading={<h3>No match</h3>}
      />,
    );

    expect(
      screen.getByRole("heading", { level: 3, name: "No match" }),
    ).toBeTruthy();
    expect(screen.getByText("Merged rows are hidden.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Clear" })).toBeTruthy();
  });

  it("leaves out the detail and the action when it has none", () => {
    render(<EmptyBlock heading={<h2>Nothing here</h2>} />);

    expect(screen.getByTestId("empty-block").childElementCount).toBe(1);
  });
});
