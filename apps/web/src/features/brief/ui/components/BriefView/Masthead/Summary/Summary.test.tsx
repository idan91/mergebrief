// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Brief } from "../../../../../model/types";
import { briefFixture } from "../../../../../test-utils/fixtures";
import { Summary } from ".";

describe("Summary", () => {
  it("parses html in the description, never in the summary", () => {
    const withHtml: Brief = {
      ...briefFixture,
      summary: 'Returns Result<T>. <img alt="Summary image" src="x.png" />',
      pr: {
        ...briefFixture.pr,
        description:
          '<img alt="Description image" src="https://github.com/user-attachments/assets/3e5dffc4-bd05-4a01-98e8-1c519ba4cf00" />',
      },
    };
    render(<Summary brief={withHtml} />);

    expect(screen.queryByRole("img", { name: "Summary image" })).toBeNull();
    expect(screen.getByTestId("brief-summary").textContent).toContain(
      '<img alt="Summary image"',
    );

    fireEvent.click(
      screen.getByRole("button", { name: /original description/i }),
    );

    expect(screen.getByRole("img", { name: "Description image" })).toBeTruthy();
  });
});
