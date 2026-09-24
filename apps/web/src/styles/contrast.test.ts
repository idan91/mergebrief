import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// The palette's contrast lines (DESIGN.md, Contrast): words 5:1 on every
// surface and 5.5:1 on the page and the list, marks 3:1. The tokens derive
// in OKLCH from four numbers, so a hue or chroma change lands here first.

const TOKENS_URL = new URL("./tokens.scss", import.meta.url);

const WORDS_MIN = 5;
const WORDS_MIN_ON_PAGE = 5.5;
const MARKS_MIN = 3;
const MAX_ALIAS_DEPTH = 8;

// A selected diff row lifts the well by a tenth of the accent, and its gutter
// numbers read against that; the tint tracks DiffRows and SplitRows, and the
// line is AA, the one exception DESIGN.md names under Contrast.
const SELECTED_ROW_TINT = 0.1;
const WELL_BACKGROUND_SHARE = 0.25;
const SELECTED_ROW_MIN = 4.5;

const SURFACES = [
  "--color-background",
  "--color-surface-1",
  "--color-surface-2",
  "--color-surface-3",
] as const;
const PAGE_SURFACES = ["--color-background", "--color-surface-1"] as const;
const WORDS = [
  "--color-text-1",
  "--color-text-read",
  "--color-text-2",
  "--color-text-3",
  "--color-diff-add-text",
  "--color-diff-del-text",
] as const;
// The accent and the state colours draw marks, and they also set words:
// delta numerals, revision tags, deletion counts, the after-brief chip. So
// they are held at both lines.
const MARKS = [
  "--color-accent",
  "--color-positive",
  "--color-negative",
  "--color-warning",
  "--color-merged",
  "--color-info",
] as const;

type Rgb = readonly [number, number, number];
type Declarations = ReadonlyMap<string, string>;

const DECLARATION = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm;
const VAR_REFERENCE = /var\((--[a-z0-9-]+)\)/g;
const OKLCH_LITERAL =
  /^oklch\(\s*([\d.]+)%\s+((?:calc\([^)]*\))|[\d.]+)\s+([\d.]+)\s*\)$/;
const CALC_STEP = /^calc\(\s*([\d.]+)\s*([*/])\s*([\d.]+)\s*\)$/;
const HEX_LITERAL = /^#([0-9a-f]{6})$/i;

async function readTokenDeclarations(): Promise<Declarations> {
  const source = await readFile(fileURLToPath(TOKENS_URL), "utf8");
  const declarations = new Map<string, string>();
  for (const match of source.matchAll(DECLARATION)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      declarations.set(name, value.replace(/\s+/g, " ").trim());
    }
  }
  return declarations;
}

function resolveTokenValue(
  declarations: Declarations,
  name: string,
  depth = 0,
): string {
  const raw = declarations.get(name);
  if (raw === undefined) {
    throw new Error(`token ${name} is not declared in tokens.scss`);
  }
  if (depth > MAX_ALIAS_DEPTH) {
    throw new Error(`token ${name} references itself`);
  }
  return raw.replace(VAR_REFERENCE, (_whole, referenced: string) =>
    resolveTokenValue(declarations, referenced, depth + 1),
  );
}

function evaluateChroma(expression: string): number {
  const step = CALC_STEP.exec(expression);
  if (step === null) {
    return Number(expression);
  }
  const [, left, operator, right] = step;
  const leftValue = Number(left);
  const rightValue = Number(right);
  return operator === "*" ? leftValue * rightValue : leftValue / rightValue;
}

function convertOklchToLinearSrgb(
  lightness: number,
  chroma: number,
  hueDegrees: number,
): Rgb {
  const hueRadians = (hueDegrees * Math.PI) / 180;
  const labA = chroma * Math.cos(hueRadians);
  const labB = chroma * Math.sin(hueRadians);
  const longCone = lightness + 0.3963377774 * labA + 0.2158037573 * labB;
  const mediumCone = lightness - 0.1055613458 * labA - 0.0638541728 * labB;
  const shortCone = lightness - 0.0894841775 * labA - 1.291485548 * labB;
  const longCubed = longCone ** 3;
  const mediumCubed = mediumCone ** 3;
  const shortCubed = shortCone ** 3;
  return [
    4.0767416621 * longCubed -
      3.3077115913 * mediumCubed +
      0.2309699292 * shortCubed,
    -1.2684380046 * longCubed +
      2.6097574011 * mediumCubed -
      0.3413193965 * shortCubed,
    -0.0041960863 * longCubed -
      0.7034186147 * mediumCubed +
      1.707614701 * shortCubed,
  ];
}

function encodeChannel(linear: number): number {
  const clamped = Math.min(1, Math.max(0, linear));
  return clamped <= 0.0031308
    ? 12.92 * clamped
    : 1.055 * clamped ** (1 / 2.4) - 0.055;
}

function decodeChannel(encoded: number): number {
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
}

function parseColor(value: string): Rgb {
  const hex = HEX_LITERAL.exec(value);
  if (hex?.[1] !== undefined) {
    const packed = Number.parseInt(hex[1], 16);
    return [(packed >> 16) & 255, (packed >> 8) & 255, packed & 255];
  }
  const oklch = OKLCH_LITERAL.exec(value);
  if (oklch === null) {
    throw new Error(`not a hex or oklch literal: ${value}`);
  }
  const [, lightness, chroma, hue] = oklch;
  const linear = convertOklchToLinearSrgb(
    Number(lightness) / 100,
    evaluateChroma(chroma ?? "0"),
    Number(hue),
  );
  const [red, green, blue] = linear;
  return [
    Math.round(encodeChannel(red) * 255),
    Math.round(encodeChannel(green) * 255),
    Math.round(encodeChannel(blue) * 255),
  ];
}

function computeLuminance([red, green, blue]: Rgb): number {
  return (
    0.2126 * decodeChannel(red / 255) +
    0.7152 * decodeChannel(green / 255) +
    0.0722 * decodeChannel(blue / 255)
  );
}

function mixSrgb(top: Rgb, bottom: Rgb, topShare: number): Rgb {
  const [topRed, topGreen, topBlue] = top;
  const [bottomRed, bottomGreen, bottomBlue] = bottom;
  const bottomShare = 1 - topShare;
  return [
    Math.round(topRed * topShare + bottomRed * bottomShare),
    Math.round(topGreen * topShare + bottomGreen * bottomShare),
    Math.round(topBlue * topShare + bottomBlue * bottomShare),
  ];
}

function computeContrast(foreground: Rgb, background: Rgb): number {
  const lighter = Math.max(
    computeLuminance(foreground),
    computeLuminance(background),
  );
  const darker = Math.min(
    computeLuminance(foreground),
    computeLuminance(background),
  );
  return (lighter + 0.05) / (darker + 0.05);
}

async function resolvePalette(): Promise<(name: string) => Rgb> {
  const declarations = await readTokenDeclarations();
  return (name) => parseColor(resolveTokenValue(declarations, name));
}

describe("palette contrast", () => {
  it("keeps every word token at 5:1 on every surface", async () => {
    const colorOf = await resolvePalette();
    const failures: string[] = [];

    for (const word of WORDS) {
      for (const surface of SURFACES) {
        const ratio = computeContrast(colorOf(word), colorOf(surface));
        if (ratio < WORDS_MIN) {
          failures.push(`${word} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps every word token at 5.5:1 on the page and the list", async () => {
    const colorOf = await resolvePalette();
    const failures: string[] = [];

    for (const word of WORDS) {
      for (const surface of PAGE_SURFACES) {
        const ratio = computeContrast(colorOf(word), colorOf(surface));
        if (ratio < WORDS_MIN_ON_PAGE) {
          failures.push(`${word} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps every mark and state colour at 3:1 on every surface", async () => {
    const colorOf = await resolvePalette();
    const failures: string[] = [];

    for (const mark of MARKS) {
      for (const surface of SURFACES) {
        const ratio = computeContrast(colorOf(mark), colorOf(surface));
        if (ratio < MARKS_MIN) {
          failures.push(`${mark} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps every mark colour readable as words on every surface", async () => {
    const colorOf = await resolvePalette();
    const failures: string[] = [];

    for (const mark of MARKS) {
      for (const surface of SURFACES) {
        const ratio = computeContrast(colorOf(mark), colorOf(surface));
        if (ratio < WORDS_MIN) {
          failures.push(`${mark} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
      for (const surface of PAGE_SURFACES) {
        const ratio = computeContrast(colorOf(mark), colorOf(surface));
        if (ratio < WORDS_MIN_ON_PAGE) {
          failures.push(`${mark} on ${surface}: ${ratio.toFixed(2)}`);
        }
      }
    }

    expect(failures).toEqual([]);
  });

  it("keeps the gutter numbers readable on a selected diff row", async () => {
    const colorOf = await resolvePalette();
    const well = mixSrgb(
      colorOf("--color-background"),
      colorOf("--color-surface-1"),
      WELL_BACKGROUND_SHARE,
    );
    const selected = mixSrgb(
      colorOf("--color-accent"),
      well,
      SELECTED_ROW_TINT,
    );

    const ratio = computeContrast(colorOf("--color-text-3"), selected);

    expect(ratio).toBeGreaterThanOrEqual(SELECTED_ROW_MIN);
  });

  it("keeps the ink on the accent readable as words", async () => {
    const colorOf = await resolvePalette();

    const ratio = computeContrast(
      colorOf("--color-on-primary"),
      colorOf("--color-accent"),
    );

    expect(ratio).toBeGreaterThanOrEqual(WORDS_MIN);
  });
});
