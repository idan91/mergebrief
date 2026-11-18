import type { PostProcessorModule } from "i18next";

/**
 * Dev-only locale id: no catalog file — every lookup falls back to en and is
 * transformed below. Strings that stay plain English on screen bypassed t():
 * the leak detector the jsx-only lint can't be.
 */
export const PSEUDO_LOCALE = "pseudo";

const ACCENTS: { [letter: string]: string } = {
  a: "á",
  b: "ƀ",
  c: "ç",
  d: "ð",
  e: "é",
  g: "ĝ",
  h: "ĥ",
  i: "í",
  j: "ĵ",
  k: "ķ",
  l: "ł",
  n: "ñ",
  o: "ó",
  r: "ř",
  s: "š",
  t: "ŧ",
  u: "ú",
  w: "ŵ",
  y: "ý",
  z: "ž",
  A: "Á",
  C: "Ç",
  E: "É",
  I: "Í",
  N: "Ñ",
  O: "Ó",
  S: "Š",
  U: "Ú",
  Y: "Ý",
  Z: "Ž",
};

// ~35% pad approximates German/Finnish-scale growth; brackets surface
// truncation. Runs AFTER interpolation, so the pad reflects rendered length.
const PAD_RATIO = 0.35;

function activeLanguage(translator: unknown): string | undefined {
  if (
    typeof translator === "object" &&
    translator !== null &&
    "language" in translator &&
    typeof translator.language === "string"
  ) {
    return translator.language;
  }
  return undefined;
}

export const pseudoPostProcessor: PostProcessorModule = {
  type: "postProcessor",
  name: "pseudo",
  process(value: string, _key, _options, translator: unknown): string {
    if (activeLanguage(translator) !== PSEUDO_LOCALE) {
      return value;
    }
    const accented = value.replace(
      /[a-zA-Z]/g,
      (char) => ACCENTS[char] ?? char,
    );
    return `[${accented}${"·".repeat(Math.ceil(value.length * PAD_RATIO))}]`;
  },
};
