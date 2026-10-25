// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { SupersededCard } from ".";

describe("SupersededCard", () => {
  it("names the newer push in a level-one heading and keeps busy", () => {
    render(
      <I18nProvider>
        <SupersededCard />
      </I18nProvider>,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toContain("newer");
    expect(screen.getByTestId("empty-block-spinner")).toBeTruthy();
  });

  it("says the newest push is briefed as usual", () => {
    render(
      <I18nProvider>
        <SupersededCard />
      </I18nProvider>,
    );

    expect(
      screen.getByText(
        "This push was superseded before its brief finished; the newest push is briefed as usual.",
      ),
    ).toBeTruthy();
  });
});
