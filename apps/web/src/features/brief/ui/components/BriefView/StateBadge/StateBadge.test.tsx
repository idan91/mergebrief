// @vitest-environment jsdom
import { render } from "@testing-library/react";
import type { PrRef } from "brief-core/types";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../../../../../i18n/I18nProvider";
import { StateBadge } from ".";

const STAMPED_OPEN: PrRef = {
  repo: "octo/hello",
  number: 7,
  title: "feat: widgets",
  url: "https://github.com/octo/hello/pull/7",
  sha: "head-1",
  description: "",
  state: "open",
  draft: false,
  merged: false,
};

describe("StateBadge", () => {
  it("renders the live state over the stamp", () => {
    const { container } = render(
      <I18nProvider>
        <StateBadge
          live={{ state: "merged", draft: false }}
          pr={STAMPED_OPEN}
        />
      </I18nProvider>,
    );

    expect(
      container
        .querySelector("[data-state-badge]")
        ?.getAttribute("data-variant"),
    ).toBe("merged");
  });

  it("renders nothing for a live state this bundle predates", () => {
    const { container } = render(
      <I18nProvider>
        <StateBadge
          live={{ state: "unknown", draft: true }}
          pr={STAMPED_OPEN}
        />
      </I18nProvider>,
    );

    expect(container.querySelector("[data-state-badge]")).toBeNull();
  });
});
