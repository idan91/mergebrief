// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { Button } from "../Button";
import { EmptyBlock } from ".";

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

  it("marks a live note as a polite region read whole", () => {
    render(<EmptyBlock heading={<h2>Waiting</h2>} note="Part 1 of 2 done." />);
    expect(
      screen.getByText("Part 1 of 2 done.").getAttribute("aria-live"),
    ).toBe(null);

    cleanup();
    render(
      <EmptyBlock
        heading={<h2>Waiting</h2>}
        note="Part 1 of 2 done."
        noteLive
      />,
    );
    const note = screen.getByText("Part 1 of 2 done.");
    expect(note.getAttribute("aria-live")).toBe("polite");
    expect(note.getAttribute("aria-atomic")).toBe("true");
  });

  it("leads with the hidden brand loader while busy", () => {
    render(<EmptyBlock busy detail="Soon." heading={<h1>Generating</h1>} />);
    const loader = screen.getByTestId("empty-block-loader");
    const heading = screen.getByRole("heading", { level: 1 });

    expect(loader.getAttribute("aria-hidden")).toBe("true");
    expect(loader.getAttribute("data-tone")).toBe("brand");
    expect(loader.getAttribute("data-size")).toBe("lg");
    expect(
      loader.compareDocumentPosition(heading) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    cleanup();
    render(<EmptyBlock heading={<h1>Done</h1>} />);
    expect(screen.queryByTestId("empty-block-loader")).toBeNull();
  });

  it("leads the block with the ghost mark, never while busy", () => {
    render(<EmptyBlock ghostMark heading={<h1>No brief yet</h1>} />);
    expect(screen.getByTestId("ghost-mark").getAttribute("aria-hidden")).toBe(
      "true",
    );

    cleanup();
    render(<EmptyBlock busy ghostMark heading={<h1>Generating</h1>} />);
    expect(screen.queryByTestId("ghost-mark")).toBeNull();
    expect(screen.getByTestId("empty-block-loader")).toBeTruthy();
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
