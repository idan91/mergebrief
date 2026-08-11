// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { FailedCard } from "./FailedCard";

afterEach(cleanup);

describe("FailedCard", () => {
  it("counts the attempt in singular on a first failure", () => {
    render(
      <I18nProvider>
        <FailedCard attempts={0} errorCode="unknown" errorDetail="boom" />
      </I18nProvider>,
    );
    expect(screen.getByText(/1 attempt so far\./)).toBeTruthy();
  });

  it("pluralizes past the first attempt", () => {
    render(
      <I18nProvider>
        <FailedCard attempts={2} errorCode="unknown" errorDetail="boom" />
      </I18nProvider>,
    );
    expect(screen.getByText(/3 attempts so far\./)).toBeTruthy();
  });

  it("renders a known code's catalog copy", () => {
    render(
      <I18nProvider>
        <FailedCard
          attempts={0}
          errorCode="provider-rate-limit"
          errorDetail={null}
        />
      </I18nProvider>,
    );
    expect(screen.getByText(/rate limit was hit/)).toBeTruthy();
  });

  it("interpolates the sanitized detail for the codes that carry one", () => {
    render(
      <I18nProvider>
        <FailedCard
          attempts={0}
          errorCode="generation-config"
          errorDetail="missing ANTHROPIC_API_KEY"
        />
      </I18nProvider>,
    );
    expect(screen.getByText(/missing ANTHROPIC_API_KEY/)).toBeTruthy();
  });

  it("falls back to the no-detail line when the failure carried none", () => {
    render(
      <I18nProvider>
        <FailedCard attempts={0} errorCode={null} errorDetail={null} />
      </I18nProvider>,
    );
    expect(screen.getByText("No failure detail was recorded.")).toBeTruthy();
  });
});
