// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { EmptyCard } from ".";

function renderCard(copyOverride?: string) {
  return render(
    createElement(
      I18nProvider,
      undefined,
      createElement(EmptyCard, { copyOverride }),
    ),
  );
}

afterEach(cleanup);

describe("EmptyCard", () => {
  it("leads the card with the ghost mark", () => {
    renderCard();
    expect(screen.getByTestId("ghost-mark")).toBeTruthy();
  });
});

describe("EmptyCard copy", () => {
  it("says the next push is briefed as usual by default", () => {
    renderCard();
    expect(screen.getByText(/next push/).textContent).toBe(
      "The next push (or a submitted review) is briefed as usual in a repository where the App is installed.",
    );
  });

  it("an override replaces the copy wholesale", () => {
    renderCard("No brief comes for this pull request.");
    expect(
      screen.getByText("No brief comes for this pull request."),
    ).toBeTruthy();
    expect(screen.queryByText(/next push/)).toBeNull();
  });
});
