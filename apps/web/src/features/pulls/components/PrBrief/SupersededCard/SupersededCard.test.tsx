// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../../../../i18n/I18nProvider";
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
    expect(screen.getByTestId("empty-block-spinner")).toBeTruthy();
  });
});
