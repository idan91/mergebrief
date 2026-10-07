// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { FailedCard } from ".";

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

  it("says a head that spent its attempts will not retry on its own", () => {
    render(
      <I18nProvider>
        <FailedCard
          attempts={0}
          errorCode="attempts-exhausted"
          errorDetail={null}
        />
      </I18nProvider>,
    );
    expect(
      screen.getByText(/using all its attempts for this push/),
    ).toBeTruthy();
    expect(screen.getByText(/will not try again on its own/)).toBeTruthy();
  });

  it("hides the attempt count for a head that spent its attempts", () => {
    render(
      <I18nProvider>
        <FailedCard
          attempts={2}
          errorCode="attempts-exhausted"
          errorDetail={null}
        />
      </I18nProvider>,
    );
    expect(screen.queryByText(/attempts? so far/)).toBeNull();
    expect(screen.getByText(/A new push re-queues generation/)).toBeTruthy();
  });

  it("keeps the attempt count for every other failure code", () => {
    render(
      <I18nProvider>
        <FailedCard
          attempts={2}
          errorCode="provider-timeout"
          errorDetail={null}
        />
      </I18nProvider>,
    );
    expect(screen.getByText(/3 attempts so far\./)).toBeTruthy();
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
