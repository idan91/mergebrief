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

  it("draws a hidden spinner ahead of the detail while busy", () => {
    render(<EmptyBlock busy detail="Soon." heading={<h1>Generating</h1>} />);
    const spinner = screen.getByTestId("empty-block-spinner");
    expect(spinner.getAttribute("aria-hidden")).toBe("true");
    expect(spinner.parentElement?.textContent).toBe("Soon.");

    cleanup();
    render(<EmptyBlock heading={<h1>Done</h1>} />);
    expect(screen.queryByTestId("empty-block-spinner")).toBeNull();
  });

  it("prints the note after the detail", () => {
    render(
      <EmptyBlock
        detail="It stopped."
        heading={<h1>Failed</h1>}
        note="3 attempts so far."
      />,
    );

    const block = screen.getByTestId("empty-block");
    const lines = [...block.querySelectorAll("p")].map((p) => p.textContent);
    expect(lines).toEqual(["It stopped.", "3 attempts so far."]);
  });

  it("renders its children under the block", () => {
    render(
      <EmptyBlock heading={<h1>Waiting</h1>}>
        <table data-testid="preview" />
      </EmptyBlock>,
    );

    const block = screen.getByTestId("empty-block");
    expect(
      block.lastElementChild?.contains(screen.getByTestId("preview")),
    ).toBe(true);
  });
});
