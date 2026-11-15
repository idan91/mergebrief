// @vitest-environment jsdom
import { I18nextProvider } from "react-i18next";
import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  readSingleKeyShortcutsOn,
  writeSingleKeyShortcutsOn,
} from "@web/utils/single-key-shortcuts";

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
});

describe("ShortcutsModal single-key switch", () => {
  afterEach(() => {
    writeSingleKeyShortcutsOn(true);
  });

  it("starts ticked and turns the single-key shortcuts off and on", () => {
    renderOpenModal();
    const toggle = screen.getByRole("checkbox", {
      name: "Single-key shortcuts",
    });
    expect(toggle).toHaveProperty("checked", true);

    fireEvent.click(toggle);
    const offAfterClick = readSingleKeyShortcutsOn();
    fireEvent.click(toggle);

    expect(offAfterClick).toBe(false);
    expect(readSingleKeyShortcutsOn()).toBe(true);
    expect(toggle).toHaveProperty("checked", true);
  });

  it("describes the switch by the hint under it", () => {
    renderOpenModal();
    const toggle = screen.getByRole("checkbox", {
      name: "Single-key shortcuts",
    });

    const hintId = toggle.getAttribute("aria-describedby") ?? "";
    const hint = document.getElementById(hintId);

    expect(hint?.textContent).toContain("Keys pressed on their own");
  });

  it("shows a choice made before it opened", () => {
    writeSingleKeyShortcutsOn(false);
    renderOpenModal();

    const toggle = screen.getByRole("checkbox", {
      name: "Single-key shortcuts",
    });
    expect(toggle).toHaveProperty("checked", false);
  });
});
