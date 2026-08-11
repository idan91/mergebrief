// @vitest-environment jsdom
import { PSEUDO_LOCALE } from "i18n";
import { afterEach, describe, expect, it } from "vitest";
import {
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
});
