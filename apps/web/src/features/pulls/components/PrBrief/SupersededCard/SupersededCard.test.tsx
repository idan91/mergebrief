// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { SupersededStops } from "../../../types";
import { SupersededCard } from ".";

afterEach(cleanup);

describe("SupersededCard", () => {
  it("names the newer push in a level-one heading and keeps busy", () => {
    render(
      <I18nProvider>
        <SupersededCard />
      </I18nProvider>,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toContain("newer");
    expect(screen.getByTestId("empty-block-loader")).toBeTruthy();
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

  it("promises no newer brief once a closed PR stops it", () => {
    render(
      <I18nProvider>
        <SupersededCard stop={SupersededStops.CLOSED} />
      </I18nProvider>,
    );

    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toBe("Generation stopped");
    expect(screen.getByTestId("empty-block").textContent).toContain(
      "no longer open, so no brief will generate",
    );
    expect(screen.queryByTestId("empty-block-loader")).toBeNull();
  });
});
