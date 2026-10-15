// @vitest-environment jsdom
import { I18nextProvider } from "react-i18next";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { appI18n } from "../../i18n/I18nProvider";
import { ShortcutsModal, type ShortcutSection } from ".";

const SECTIONS: ShortcutSection[] = [
  {
    id: "list",
    headingKey: "home.shortcuts.sectionList",
    shortcuts: [
      { keys: ["Enter"], descriptionKey: "home.shortcuts.openRow" },
      {
        keys: ["Shift", "?"],
        descriptionKey: "home.shortcuts.toggleShortcuts",
      },
    ],
  },
];

function renderOpenModal(close = vi.fn()) {
  render(
    <I18nextProvider i18n={appI18n}>
      <ShortcutsModal close={close} open sections={SECTIONS} />
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
  it("lists the sections it is handed, then the marks", () => {
    renderOpenModal();
    const dialog = screen.getByRole("dialog", { name: "Keyboard shortcuts" });
    expect(dialog.querySelector("h2")?.textContent).toBe("Keyboard shortcuts");
    const headings = screen.getAllByRole("heading", { level: 3 });
    expect(headings.map((heading) => heading.textContent)).toEqual([
      "Briefs",
      "Marks",
    ]);
    expect(
      readSectionKeys(screen.getByRole("heading", { name: "Briefs" })),
    ).toEqual(["Enter", "Shift", "?"]);
  });

  it("closes from the Close button", () => {
    const close = renderOpenModal();
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("renders a chord as separate caps joined by a plus", () => {
    renderOpenModal();
    const toggle = screen.getByText("Toggle this shortcuts list");
    const caps = [...(toggle.closest("div")?.querySelectorAll("kbd") ?? [])];
    expect(caps.map((cap) => cap.textContent)).toEqual(["Shift", "?"]);
    expect(toggle.closest("div")?.querySelector("dt")?.textContent).toBe(
      "Shift+?",
    );
  });
});
