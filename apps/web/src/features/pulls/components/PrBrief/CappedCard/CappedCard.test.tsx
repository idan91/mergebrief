// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { CappedCard } from ".";

describe("CappedCard", () => {
  it("renders the cap heading and says the push is not retried on its own", () => {
    render(
      <I18nProvider>
        <CappedCard
          appInstalled
          cappedAt="2026-08-03T18:30:00.000Z"
          prState="open"
        />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("heading", { name: /daily generation cap reached/i }),
    ).toBeDefined();
    expect(screen.getByTestId("brief-capped-card").textContent).toContain(
      "will not be picked up again on its own",
    );
  });

  it("heads a large run's refusal with the runs it lacked", () => {
    render(
      <I18nProvider>
        <CappedCard
          appInstalled
          cappedAt="2026-08-03T18:30:00.000Z"
          prState="open"
          units={{ needed: 9, left: 4, cap: 20 }}
        />
      </I18nProvider>,
    );
    expect(
      screen.getByRole("heading", { name: /too few runs were left/i }),
    ).toBeDefined();
    expect(screen.queryByRole("heading", { name: /cap reached/i })).toBeNull();
  });

  it("heads a run no day fits with the cap and no resume time", () => {
    render(
      <I18nProvider>
        <CappedCard
          appInstalled
          cappedAt="2026-08-03T18:30:00.000Z"
          prState="open"
          units={{ needed: 9, left: 4, cap: 9 }}
        />
      </I18nProvider>,
    );
    expect(screen.getByRole("heading").textContent).toBe(
      "This pull request is too large for this instance's daily cap.",
    );
  });
});
