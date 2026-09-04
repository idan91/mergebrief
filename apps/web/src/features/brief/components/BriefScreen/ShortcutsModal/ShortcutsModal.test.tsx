// @vitest-environment jsdom
import { I18nextProvider } from "react-i18next";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { appI18n } from "../../../../../i18n/I18nProvider";
import { ShortcutsModal } from "./ShortcutsModal";

afterEach(cleanup);

function renderOpenModal(close = vi.fn()) {
  render(
    <I18nextProvider i18n={appI18n}>
      <ShortcutsModal close={close} open />
    </I18nextProvider>,
  );
  return close;
}

function readSectionKeys(heading: HTMLElement): string[] {
  const section = heading.closest("section");
  const caps = section?.querySelectorAll("kbd") ?? [];
  return [...caps].map((cap) => cap.textContent);
}

describe("ShortcutsModal", () => {
  it("groups the bindings under a general and a focus-mode heading", () => {
    renderOpenModal();
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog.querySelector("h2")?.textContent).toBe("Keyboard shortcuts");
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "General",
      "Focus mode",
    ]);
  });

  it("keeps Z, V and Esc together in the focus-mode section", () => {
    renderOpenModal();
    const focusHeading = screen.getByRole("heading", {
      level: 3,
      name: "Focus mode",
    });
    expect(readSectionKeys(focusHeading)).toEqual(["Z", "V", "Esc"]);
  });

  it("lists Esc twice with one meaning per line", () => {
    renderOpenModal();
    const descriptions = screen
      .getAllByText("Esc")
      .map((cap) => cap.closest("div")?.querySelector("dd")?.textContent);
    expect(descriptions).toEqual(["Close a dialog", "Exit focus mode"]);
  });

  it("closes from the Close button", () => {
    const close = renderOpenModal();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalledTimes(1);
  });
});
