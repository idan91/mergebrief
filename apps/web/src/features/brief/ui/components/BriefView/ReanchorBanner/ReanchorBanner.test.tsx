// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { I18nProvider } from "../../../../../../i18n/I18nProvider";
import { ReanchorBanner } from ".";

function renderBanner(cancel = vi.fn()) {
  const view = render(
    <I18nProvider>
      <ReanchorBanner cancel={cancel} location="src/leak.ts:+10" />
    </I18nProvider>,
  );
  return { view, cancel };
}

function readBannerHeight(): string {
  return document.documentElement.style.getPropertyValue("--reanchor-banner-h");
}

describe("ReanchorBanner", () => {
  it("names the mode, the armed draft and the Escape way out", () => {
    renderBanner();
    const banner = screen.getByRole("region", { name: "Re-anchor mode" });
    expect(banner.textContent).toContain("src/leak.ts:+10");
    expect(banner.querySelector("kbd")?.textContent).toBe("Esc");
  });

  it("is not a live region, the store announces arm and cancel", () => {
    renderBanner();
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("publishes its height and returns it to zero on unmount", () => {
    const offsetHeight = vi
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockReturnValue(64);
    try {
      const { view } = renderBanner();
      expect(readBannerHeight()).toBe("64px");
      view.unmount();
      expect(readBannerHeight()).toBe("0px");
    } finally {
      offsetHeight.mockRestore();
    }
  });
});
