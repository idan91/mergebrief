// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { CopyRow } from ".";

describe("CopyRow", () => {
  it("adds no stray class when the caller passes none", () => {
    render(<CopyRow label="Copy file path" text="src/a.ts" />);

    const row = screen.getByRole("button", { name: /Copy file path/ });
    expect(row.className).not.toContain("undefined");
  });
});
