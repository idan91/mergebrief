import { createInstance } from "i18next";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createI18n, en as enCatalog, PSEUDO_LOCALE } from "../src/index";
import type { TranslationKey } from "../src/index";

describe("createI18n", () => {
  it("is usable synchronously on the next line", () => {
    expect(createI18n().t("errors.not-found")).toBe("not found");
  });

  it("interpolates params without HTML-entity escaping", () => {
    const i18n = createI18n();
    expect(
      i18n.t("generationError.generation-config", {
        detail: "model & key unset",
      }),
    ).toBe("Generator configuration is invalid: model & key unset");
    expect(i18n.t("generationError.unknown", { detail: "exit code 7" })).toBe(
      "Generation failed: exit code 7",
    );
  });

  it("falls back to en for an unshipped locale", () => {
    expect(createI18n({ locale: "fr" }).t("errors.forbidden")).toBe(
      "forbidden",
    );
  });

  it("keeps instances independent", () => {
    const en = createI18n();
    const pseudo = createI18n({ locale: PSEUDO_LOCALE });
    expect(pseudo.language).toBe(PSEUDO_LOCALE);
    expect(en.language).toBe("en");
  });
});

describe("inline context", () => {
  it("reads a label mid-sentence through its _inline variant", () => {
    const i18n = createI18n();
    expect(i18n.t("brief.category.newFeature")).toBe("New feature");
    expect(i18n.t("brief.category.newFeature", { context: "inline" })).toBe(
      "new feature",
    );
  });

  it("falls back to the base label where a locale omits the variant", () => {
    const i18n = createInstance();
    void i18n.init({
      resources: {
        en: { translation: enCatalog },
        de: {
          translation: { brief: { category: { newFeature: "Neue Funktion" } } },
        },
      },
      lng: "de",
      fallbackLng: "en",
      initAsync: false,
    });
    expect(i18n.t("brief.category.newFeature", { context: "inline" })).toBe(
      "Neue Funktion",
    );
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
});

describe("typed keys", () => {
  it("exposes the catalog as a dotted key union", () => {
    expectTypeOf<"errors.not-found">().toMatchTypeOf<TranslationKey>();
    expectTypeOf<"generationError.unknown">().toMatchTypeOf<TranslationKey>();
    expectTypeOf<"errors.no-such-code">().not.toMatchTypeOf<TranslationKey>();
  });

  it("collapses an _inline variant onto its base key", () => {
    expectTypeOf<"brief.category.newFeature">().toMatchTypeOf<TranslationKey>();
    expectTypeOf<"brief.category.newFeature_inline">().not.toMatchTypeOf<TranslationKey>();
  });

  it("types the inline context only on a key that has the variant", () => {
    const i18n = createI18n();
    expect(i18n.t("brief.riskLabel.hotPath", { context: "inline" })).toBe(
      "hot path",
    );
    // @ts-expect-error, a key without an _inline variant takes no inline context
    expect(i18n.t("brief.concern.test", { context: "inline" })).toBe("Test");
  });

  it("rejects an unknown key at compile time", () => {
    const i18n = createI18n();
    // @ts-expect-error, a key absent from en.json must not compile
    expect(i18n.t("errors.no-such-code")).toBeTruthy();
  });

  it("rejects mistyped interpolation replacements at compile time", () => {
    const i18n = createI18n();
    expect(i18n.t("tokens.nameTooLong", { max: 100 })).toContain("100");
    // @ts-expect-error, the template requires max, not a mistyped replacement
    const wrongName = i18n.t("tokens.nameTooLong", { wrong: 100 });
    expect(wrongName).toBeTruthy();
    const numberFormattedKey = "review.comment.tooLongToPost";
    // @ts-expect-error, the number formatter requires a numeric max
    const wrongType = i18n.t(numberFormattedKey, { max: "65,536" });
    expect(wrongType).toBeTruthy();
  });
});
