// @vitest-environment jsdom
// Vitest runs as a dev build, so the pseudo row is present alongside the
// registry's locales.
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { LOCALES, PSEUDO_LOCALE } from "i18n";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appI18n, changeLocale, I18nProvider } from "../I18nProvider";
import { LOCALE_STORAGE_KEY } from "../locale";
import { LocalePicker } from "./LocalePicker";

afterEach(async () => {
  cleanup();
  window.localStorage.clear();
  await changeLocale("en");
});

function renderPicker() {
  return render(
    <I18nProvider>
      <LocalePicker />
    </I18nProvider>,
  );
}

/** Render, then open — every menu assertion needs both. */
function openMenu() {
  renderPicker();
  fireEvent.click(screen.getByRole("button", { name: /language/i }));
  return screen.getByRole("menu");
}

// The picker is gated behind ENABLE_LANGUAGE_SELECTION and off by default;
// these cases are about the control itself, so they run with it on.
beforeEach(() => {
  vi.stubEnv("ENABLE_LANGUAGE_SELECTION", "true");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("LocalePicker", () => {
  it("renders nothing unless ENABLE_LANGUAGE_SELECTION is on", () => {
    // The default. Language selection ships wired but withheld, so the flag
    // being off has to mean no control at all — not a hidden one that is
    // still in the tab order.
    vi.stubEnv("ENABLE_LANGUAGE_SELECTION", "");
    const { container } = render(<LocalePicker />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("names the active language on the trigger", () => {
    renderPicker();
    expect(
      screen.getByRole("button", { name: /language: english/i }),
    ).toBeDefined();
  });

  it("lists every registry locale plus the dev pseudo entry", () => {
    openMenu();
    const items = screen.getAllByRole("menuitemradio");
    expect(items).toHaveLength(LOCALES.length + 1);
    // The trigger also shows the active name, so assert inside the MENU.
    const labels = items.map((item) => item.textContent ?? "");
    for (const entry of LOCALES) {
      expect(labels.some((label) => label.includes(entry.nativeName))).toBe(
        true,
      );
    }
    expect(labels.some((label) => /pseudo/i.test(label))).toBe(true);
  });

  it("marks exactly the active row as checked", () => {
    openMenu();
    const checked = screen
      .getAllByRole("menuitemradio")
      .filter((item) => item.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(1);
    expect(checked[0]?.textContent).toContain("English");
  });

  it("tags each row with its own lang so AT announces it correctly", () => {
    openMenu();
    const english = screen
      .getAllByRole("menuitemradio")
      .find((item) => item.textContent?.includes("English"));
    expect(english?.getAttribute("lang")).toBe("en");
    // Pseudo is not a real language — tagging it would mislead a screen reader.
    const pseudo = screen
      .getAllByRole("menuitemradio")
      .find((item) => item.textContent?.toLowerCase().includes("pseudo"));
    expect(pseudo?.getAttribute("lang")).toBeNull();
  });

  it("opens on ArrowDown from the trigger and moves focus to the active row", () => {
    renderPicker();
    const trigger = screen.getByRole("button", { name: /language/i });
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    expect(screen.getByRole("menu")).toBeDefined();
    expect(document.activeElement?.textContent).toContain("English");
  });

  it("roams with ArrowDown/Home/End", () => {
    const menu = openMenu();
    const items = screen.getAllByRole("menuitemradio");
    fireEvent.keyDown(items[0] as HTMLElement, { key: "ArrowDown" });
    expect(document.activeElement).toBe(items[1]);
    fireEvent.keyDown(items[1] as HTMLElement, { key: "Home" });
    expect(document.activeElement).toBe(items[0]);
    fireEvent.keyDown(items[0] as HTMLElement, { key: "End" });
    expect(document.activeElement).toBe(items.at(-1));
    fireEvent.keyDown(items.at(-1) as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items.at(-2));
    // ArrowUp from the first row wraps to the last.
    fireEvent.keyDown(items[0] as HTMLElement, { key: "ArrowUp" });
    expect(document.activeElement).toBe(items.at(-1));
    // Roaming never closes the menu.
    expect(screen.queryByRole("menu")).not.toBeNull();
    expect(menu).toBe(screen.getByRole("menu"));
  });

  it("keeps exactly one tab stop and lets Tab leave the menu", () => {
    const menu = openMenu();
    const items = screen.getAllByRole("menuitemradio");
    const tabbable = items.filter(
      (item) => item.getAttribute("tabindex") === "0",
    );
    expect(tabbable).toHaveLength(1);
    fireEvent.keyDown(menu, { key: "Tab" });
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("still renders when the registry is the only source (prod build)", () => {
    vi.stubEnv("DEV", false);
    renderPicker();
    expect(screen.getByRole("button", { name: /language/i })).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /language/i }));
    expect(screen.getAllByRole("menuitemradio")).toHaveLength(LOCALES.length);
    expect(screen.queryByText(/pseudo/i)).toBeNull();
    vi.unstubAllEnvs();
  });

  it("checks no row when the runtime locale is in none of them", async () => {
    renderPicker();
    await changeLocale("de-AT");
    fireEvent.click(screen.getByRole("button", { name: /language/i }));
    const checked = screen
      .getAllByRole("menuitemradio")
      .filter((item) => item.getAttribute("aria-checked") === "true");
    expect(checked).toHaveLength(0);
  });

  it("Escape closes and returns focus to the trigger", () => {
    const menu = openMenu();
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: /language/i }),
    );
  });

  it("an outside pointerdown closes without stealing focus", () => {
    openMenu();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("choosing a locale switches the runtime and persists it", async () => {
    openMenu();
    // Captured BEFORE the switch: the trigger's accessible name is itself
    // translated, so it stops matching an English query afterwards.
    const trigger = screen.getByRole("button", { name: /language/i });
    const pseudo = screen
      .getAllByRole("menuitemradio")
      .find((item) => item.textContent?.toLowerCase().includes("pseudo"));
    fireEvent.click(pseudo as HTMLElement);
    // changeLocale is async; the store write happens after it resolves.
    await Promise.resolve();
    await Promise.resolve();
    expect(appI18n.language).toBe(PSEUDO_LOCALE);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe(PSEUDO_LOCALE);
    expect(screen.queryByRole("menu")).toBeNull();
    // Selection removes the focused row — focus must land on the trigger.
    expect(document.activeElement).toBe(trigger);
  });
});
