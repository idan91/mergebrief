import { describe, expect, it } from "vitest";

import { BRIEF_SHORTCUT_SECTIONS } from "./consts";

describe("BRIEF_SHORTCUT_SECTIONS", () => {
  it("groups the bindings under general then focus mode", () => {
    expect(BRIEF_SHORTCUT_SECTIONS.map((section) => section.id)).toEqual([
      "general",
      "focus-mode",
    ]);
  });

  it("keeps Z, V and Esc together in the focus-mode section", () => {
    const focusMode = BRIEF_SHORTCUT_SECTIONS[1];
    expect(focusMode?.shortcuts.map((shortcut) => shortcut.keys)).toEqual([
      ["Z"],
      ["V"],
      ["Esc"],
    ]);
  });

  it("lists Esc twice with one meaning per line", () => {
    const escapes = BRIEF_SHORTCUT_SECTIONS.flatMap((section) =>
      section.shortcuts.filter((shortcut) => shortcut.keys[0] === "Esc"),
    );
    expect(escapes.map((shortcut) => shortcut.descriptionKey)).toEqual([
      "brief.shortcuts.closeDialog",
      "brief.shortcuts.exitFocusMode",
    ]);
  });
});
