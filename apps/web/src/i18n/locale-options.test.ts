// Vitest runs as a dev build, so the pseudo row is present alongside the
// registry's locales.
import { LOCALES, PSEUDO_LOCALE } from "i18n";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  findActiveLocaleIndex,
  isLanguageSelectionEnabled,
  listLocaleOptions,
} from "./locale-options";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("isLanguageSelectionEnabled", () => {
  it("is off unless the flag is switched on", () => {
    vi.stubEnv("ENABLE_LANGUAGE_SELECTION", "");
    expect(isLanguageSelectionEnabled()).toBe(false);
    vi.stubEnv("ENABLE_LANGUAGE_SELECTION", "true");
    expect(isLanguageSelectionEnabled()).toBe(true);
    vi.stubEnv("ENABLE_LANGUAGE_SELECTION", "1");
    expect(isLanguageSelectionEnabled()).toBe(true);
  });
});

describe("listLocaleOptions", () => {
  it("lists every registry locale plus the dev pseudo entry", () => {
    const options = listLocaleOptions();

    expect(options.map((option) => option.id)).toEqual([
      ...LOCALES.map((entry) => entry.id),
      PSEUDO_LOCALE,
    ]);
    expect(options.at(-1)?.nativeName).toMatch(/pseudo/i);
  });
});

describe("findActiveLocaleIndex", () => {
  const options = listLocaleOptions();

  it("matches the runtime locale to its row", () => {
    expect(findActiveLocaleIndex(options, "en")).toBe(
      options.findIndex((option) => option.id === "en"),
    );
  });

  it("a region tag falls back to its base row", () => {
    const base = LOCALES[0]?.id ?? "en";
    expect(findActiveLocaleIndex(options, `${base}-AT`)).toBe(
      options.findIndex((option) => option.id === base),
    );
  });

  it("no row matches an unknown locale, so nothing is checked", () => {
    expect(findActiveLocaleIndex(options, "xx")).toBe(-1);
  });
});
