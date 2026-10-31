// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PackageSourceFiles } from ".";

describe("PackageSourceFiles", () => {
  it("names its region after the flag and lists each file", () => {
    render(<PackageSourceFiles files={[".npmrc", "pnpm-lock.yaml"]} />);

    const region = screen.getByRole("region", {
      name: "Changes package source",
    });
    const items = within(region).getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      ".npmrc",
      "pnpm-lock.yaml",
    ]);
  });
});
