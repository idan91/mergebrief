import { describe, expect, expectTypeOf, it } from "vitest";
import { createI18n, PSEUDO_LOCALE } from "../src/index";
import type { TranslationKey } from "../src/index";

describe("createI18n", () => {
  it("is usable synchronously — t() works on the next line", () => {
    expect(createI18n().t("errors.not-found")).toBe("not found");
  });

  it("interpolates params without HTML-entity escaping", () => {
    const i18n = createI18n();
    expect(
      i18n.t("errors.generation-config", { detail: "model & key unset" }),
    ).toBe("model & key unset");
    expect(i18n.t("generationError.unknown", { detail: "exit code 7" })).toBe(
      "Generation failed: exit code 7",
    );
  });

  it("falls back to en for an unshipped locale", () => {
    expect(createI18n({ locale: "fr" }).t("errors.forbidden")).toBe(
      "forbidden",
    );
  });

  it("walks region → base-lang → en", () => {
    expect(createI18n({ locale: "en-GB" }).t("errors.unauthorized")).toBe(
      "unauthorized",
    );
  });

  it("keeps instances independent", () => {
    const en = createI18n();
    const pseudo = createI18n({ locale: PSEUDO_LOCALE });
    expect(pseudo.language).toBe(PSEUDO_LOCALE);
    expect(en.language).toBe("en");
  });
});

describe("pseudo locale end-to-end", () => {
  it("renders accented, padded, bracketed copy", () => {
    const rendered = createI18n({ locale: PSEUDO_LOCALE }).t(
      "errors.not-found",
    );
    expect(rendered.startsWith("[")).toBe(true);
    expect(rendered.endsWith("]")).toBe(true);
    expect(rendered).not.toContain("not found");
    expect(rendered.length).toBeGreaterThan("not found".length);
  });

  it("pads AFTER interpolation so growth tracks rendered length", () => {
    const short = createI18n({ locale: PSEUDO_LOCALE }).t(
      "generationError.unknown",
      { detail: "x" },
    );
    const long = createI18n({ locale: PSEUDO_LOCALE }).t(
      "generationError.unknown",
      { detail: "a much longer detail line" },
    );
    expect(long.length).toBeGreaterThan(short.length);
  });

  it("stays inert for real locales", () => {
    expect(createI18n().t("errors.not-found")).toBe("not found");
  });
});

describe("typed keys", () => {
  it("exposes the catalog as a dotted key union", () => {
    expectTypeOf<"errors.not-found">().toMatchTypeOf<TranslationKey>();
    expectTypeOf<"generationError.unknown">().toMatchTypeOf<TranslationKey>();
    expectTypeOf<"errors.no-such-code">().not.toMatchTypeOf<TranslationKey>();
  });

  it("rejects an unknown key at compile time", () => {
    const i18n = createI18n();
    // @ts-expect-error — key absent from en.json must not compile
    expect(i18n.t("errors.no-such-code")).toBeTruthy();
  });
});
