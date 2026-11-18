// @vitest-environment jsdom
import { I18nextProvider } from "react-i18next";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appI18n } from "../../i18n/I18nProvider";
import { RegionBoundary } from ".";

const fault = { thrown: true };

function FaultyRegion() {
  if (fault.thrown) {
    throw new Error("render failed");
  }
  return <p>Two threads</p>;
}

function renderPage(resetKey = "brief-1") {
  return render(
    <I18nextProvider i18n={appI18n}>
      <p>The brief</p>
      <RegionBoundary
        heading={<h2>The conversation could not be shown</h2>}
        resetKey={resetKey}
      >
        <FaultyRegion />
      </RegionBoundary>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  fault.thrown = true;
  // React reports a caught render error on the console; that is the path under test.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("RegionBoundary", () => {
  it("sizes its failure for a region, not for a page", () => {
    renderPage();

    expect(screen.getByRole("alert").getAttribute("data-scale")).toBe("region");
  });

  it("shows the region when nothing fails", () => {
    fault.thrown = false;
    renderPage();

    expect(screen.getByText("Two threads")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("names the failed region and leaves the rest of the page", () => {
    renderPage();

    expect(screen.getByRole("alert").textContent).toContain(
      "The conversation could not be shown",
    );
    expect(screen.getByText("The brief")).toBeTruthy();
  });

  it("shows the region again when a retry finds it working", () => {
    renderPage();
    fault.thrown = false;

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    expect(screen.getByText("Two threads")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clears a failure when the region is given something else to show", () => {
    const page = renderPage("brief-1");
    fault.thrown = false;

    page.rerender(
      <I18nextProvider i18n={appI18n}>
        <p>The brief</p>
        <RegionBoundary
          heading={<h2>The conversation could not be shown</h2>}
          resetKey="brief-2"
        >
          <FaultyRegion />
        </RegionBoundary>
      </I18nextProvider>,
    );

    expect(screen.getByText("Two threads")).toBeTruthy();
  });
});
