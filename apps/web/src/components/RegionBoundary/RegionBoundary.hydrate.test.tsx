// @vitest-environment jsdom
import { act, cleanup, fireEvent, screen } from "@testing-library/react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appI18n } from "../../i18n/I18nProvider";
import { RegionBoundary } from ".";

const REGION_TEXT = "Two threads";
const REGION_HEADING = "The conversation could not be shown";

const fault = { thrown: true };
let root: Root | undefined;

function FaultyRegion() {
  if (fault.thrown) {
    throw new Error("render failed");
  }
  return <p>{REGION_TEXT}</p>;
}

function Page() {
  return (
    <I18nextProvider i18n={appI18n}>
      <p>The brief</p>
      <RegionBoundary
        heading={<h2>{REGION_HEADING}</h2>}
        holdsServerFailure
        resetKey="brief-1"
      >
        <FaultyRegion />
      </RegionBoundary>
    </I18nextProvider>
  );
}

/** The page as the server sent it when the region threw there. */
function mountServerFailure(): HTMLElement {
  fault.thrown = true;
  const container = document.createElement("div");
  container.innerHTML = renderToString(<Page />);
  document.body.append(container);
  return container;
}

async function hydratePage(container: HTMLElement) {
  const onRecoverableError = vi.fn();
  await act(async () => {
    root = hydrateRoot(container, <Page />, { onRecoverableError });
    await Promise.resolve();
  });
  return onRecoverableError;
}

beforeEach(() => {
  // React reports a caught render error on the console; that is the path under test.
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  cleanup();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("a region the server sent as a failure", () => {
  it("arrives holding the failure and the rest of the page", () => {
    mountServerFailure();

    expect(screen.getByRole("alert").textContent).toContain(REGION_HEADING);
    expect(screen.getByText("The brief")).toBeTruthy();
  });

  it("shows the region once the client renders what the server could not", async () => {
    const container = mountServerFailure();
    fault.thrown = false;

    const onRecoverableError = await hydratePage(container);

    expect(screen.getByText(REGION_TEXT)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(onRecoverableError).toHaveBeenCalledTimes(1);
  });

  it("offers a retry that works when the client throws as well", async () => {
    const container = mountServerFailure();
    await hydratePage(container);
    expect(screen.getByRole("alert").textContent).toContain(REGION_HEADING);
    fault.thrown = false;

    const retry = screen.getByRole("button", {
      name: appI18n.t("shell.regionFailed.retry"),
    });
    fireEvent.click(retry);

    expect(screen.getByText(REGION_TEXT)).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
