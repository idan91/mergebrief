// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { CappedCard } from ".";

describe("CappedCard", () => {
  it("renders the cap heading and says the push is not retried on its own", () => {
    render(
      <I18nProvider>
        <CappedCard cappedAt="2026-08-03T18:30:00.000Z" />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("heading", { name: /daily generation cap reached/i }),
    ).toBeDefined();
    expect(screen.getByTestId("brief-capped-card").textContent).toContain(
      "will not be picked up again on its own",
    );
  });
});
