// @vitest-environment jsdom
import { render } from "@testing-library/react";
import type { PrRef } from "brief-core/types";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "../../../../../../i18n/I18nProvider";
import { StateBadge, type StateBadgeProps } from ".";

const UNSTAMPED: PrRef = {
  repo: "octo/hello",
  number: 7,
  title: "feat: widgets",
  url: "https://github.com/octo/hello/pull/7",
  sha: "head-1",
  description: "",
};

const STAMPED_OPEN: PrRef = {
  ...UNSTAMPED,
  state: "open",
  draft: false,
  merged: false,
};

function readBadge(props: StateBadgeProps): Element | null {
  const { container } = render(
    <I18nProvider>
      <StateBadge {...props} />
    </I18nProvider>,
  );
  return container.querySelector("[data-state-badge]");
}

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

  it.each([
    ["open", false, false, "open", "Open"],
    ["open", true, false, "draft", "Draft"],
    ["closed", false, false, "closed", "Closed"],
    // Draft supersedes OPEN, never closed.
    ["closed", true, false, "closed", "Closed"],
    ["closed", false, true, "merged", "Merged"],
    // Draft flag on a merged snapshot: merged still wins.
    ["closed", true, true, "merged", "Merged"],
  ] as const)(
    "state=%s draft=%s merged=%s → %s badge",
    (state, draft, merged, variant, label) => {
      const badge = readBadge({ pr: { ...UNSTAMPED, state, draft, merged } });
      expect(badge?.getAttribute("data-variant")).toBe(variant);
      // Visible text is the state word; SR text carries the prefix.
      expect(badge?.textContent).toBe(`pull request ${label}`);
    },
  );

  it.each([
    ["open", false, "open"],
    ["open", true, "draft"],
    ["closed", false, "closed"],
    // The live DB vocabulary folds merged INTO the state.
    ["merged", false, "merged"],
    ["merged", true, "merged"],
  ] as const)(
    "live state=%s draft=%s → %s badge on an unstamped artifact",
    (state, draft, variant) => {
      const badge = readBadge({ pr: UNSTAMPED, live: { state, draft } });
      expect(badge?.getAttribute("data-variant")).toBe(variant);
    },
  );
});
