// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { NoInstallationLine } from ".";

describe("NoInstallationLine", () => {
  it("links the install page when the instance names one", () => {
    render(
      <NoInstallationLine installUrl="https://github.com/apps/x/installations/new" />,
    );

    expect(
      screen
        .getByRole("link", { name: "Install it on GitHub" })
        .getAttribute("href"),
    ).toBe("https://github.com/apps/x/installations/new");
  });

  it("keeps the line and drops the link when there is no page to name", () => {
    render(<NoInstallationLine installUrl={undefined} />);

    expect(screen.getByText(/installed on no repository/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
