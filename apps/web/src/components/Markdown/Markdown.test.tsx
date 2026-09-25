// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Markdown } from ".";

afterEach(cleanup);

describe("Markdown suggestion fences", () => {
  const body = "Try this:\n```suggestion\nreturn next;\n```";

  it("renders a Suggested-change card for an opted-in comment body", () => {
    render(<Markdown content={body} renderSuggestions />);
    expect(screen.getByText("Suggested change")).toBeTruthy();
    const table = screen.getByRole("table", { name: "Suggested change diff" });
    expect(table.textContent).toContain("return next;");
    // The fence is stripped from the text; the intro stays.
    expect(screen.getByText("Try this:")).toBeTruthy();
    expect(screen.queryByText(/```/)).toBeNull();
  });

  it("leaves fences as plain code in brief text, without the opt-in", () => {
    render(<Markdown content={body} />);
    expect(screen.queryByText("Suggested change")).toBeNull();
  });
});

describe("Markdown headings", () => {
  it("demotes authored headings so a body never adds a page-level h1", () => {
    render(<Markdown content={"# Summary\n\n## Detail"} />);

    expect(screen.getByRole("heading", { name: "Summary" }).tagName).toBe("H3");
    expect(screen.getByRole("heading", { name: "Detail" }).tagName).toBe("H4");
  });
});
