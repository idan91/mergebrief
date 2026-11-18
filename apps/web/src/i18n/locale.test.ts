// @vitest-environment jsdom
import { PSEUDO_LOCALE } from "i18n";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatDate,
  LOCALE_STORAGE_KEY,
  persistLocale,
  resolveInitialLocale,
} from "./locale";

describe("resolveInitialLocale", () => {
  afterEach(() => {
    window.localStorage.clear();
  });

  it("prefers a stored registry locale", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "en");
    expect(resolveInitialLocale()).toBe("en");
  });

  it("ignores a stored locale outside the registry", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, "xx-garbage");
    expect(resolveInitialLocale()).toBe(window.navigator.language);
  });

  it("admits the pseudo locale in dev builds (vitest runs as dev)", () => {
    window.localStorage.setItem(LOCALE_STORAGE_KEY, PSEUDO_LOCALE);
    expect(resolveInitialLocale()).toBe(PSEUDO_LOCALE);
  });

  it("falls back to navigator.language when nothing is stored", () => {
    expect(resolveInitialLocale()).toBe(window.navigator.language);
  });

  it("persistLocale writes the choice", () => {
    persistLocale("en");
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe("en");
  });

  it("formats dates with the rendered locale instead of the browser default", () => {
    const iso = "2026-01-02T12:00:00.000Z";
    const options: Intl.DateTimeFormatOptions = {
      year: "numeric",
      month: "short",
      day: "numeric",
    };
    expect(formatDate(iso, "fr", options)).toBe(
      new Intl.DateTimeFormat("fr", options).format(new Date(iso)),
    );
    expect(formatDate(iso, "fr", options)).not.toBe(
      new Intl.DateTimeFormat("en-US", options).format(new Date(iso)),
    );
  });
});
