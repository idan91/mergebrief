// The drafts-off empty-state copy override.
// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { I18nProvider } from "../../../../../i18n/I18nProvider";
import { EmptyCard } from ".";

afterEach(cleanup);

function renderCard(copyOverride?: string) {
  return render(
    createElement(
      I18nProvider,
      undefined,
      createElement(EmptyCard, { copyOverride }),
    ),
  );
}

describe("EmptyCard copy", () => {
  it("promises next-push generation by default", () => {
    renderCard();
    expect(screen.getByText(/next push/).textContent).toContain("next push");
  });

  it("the drafts-off override replaces the copy wholesale", () => {
    renderCard("Drafts are off.");
    expect(screen.getByText("Drafts are off.")).toBeTruthy();
    expect(screen.queryByText(/next push/)).toBeNull();
  });
});
