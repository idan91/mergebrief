// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { Brief } from "../../../../model/types";
import { briefFixture } from "../../../../test-utils/fixtures";
import { DeltaContext } from ".";

const delta: Brief = {
  ...briefFixture,
  artifactKind: "delta",
  wholePrImpact: "Completes the original intent.",
};

describe("DeltaContext", () => {
  it("lists the flagged files no delta chunk covers under the flag", () => {
    render(
      <DeltaContext
        brief={{ ...delta, packageSourceFiles: [".npmrc", "pnpm-lock.yaml"] }}
      />,
    );

    const section = screen.getByRole("region", {
      name: "Changes package source",
    });
    const files = within(section).getAllByRole("listitem");
    expect(files.map((file) => file.textContent)).toEqual([
      ".npmrc",
      "pnpm-lock.yaml",
    ]);
    expect(within(section).getByText(/No chunk in this delta/)).toBeTruthy();
  });

  it("shows no flagged file section on a delta without one", () => {
    render(<DeltaContext brief={delta} />);

    expect(screen.queryByText("Changes package source")).toBeNull();
  });
});
