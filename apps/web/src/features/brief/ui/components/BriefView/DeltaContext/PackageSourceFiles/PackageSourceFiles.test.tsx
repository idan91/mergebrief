// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { PackageSourceFiles } from ".";

afterEach(cleanup);

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

  it("lists a path with a bidi override by a visible escape", () => {
    render(<PackageSourceFiles files={["\u202Ec.npmrc", "שלום/.npmrc"]} />);

    const items = screen.getAllByRole("listitem");
    expect(items.map((item) => item.textContent)).toEqual([
      "[U+202E]c.npmrc",
      "שלום/.npmrc",
    ]);
  });
});
