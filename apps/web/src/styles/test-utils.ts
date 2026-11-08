import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// Reads the palette straight from tokens.scss, so a test judges the values
// that ship. Only hex and the OKLCH forms the tokens use are understood.

// Built from the module's own path: a jsdom suite rewrites
// `new URL("./x", import.meta.url)` into an asset URL.
const TOKENS_PATH = join(
  dirname(fileURLToPath(import.meta.url)),
  "tokens.scss",
);
const MAX_ALIAS_DEPTH = 8;

export type Rgb = readonly [number, number, number];
export type Declarations = ReadonlyMap<string, string>;

const DECLARATION = /^\s*(--[a-z0-9-]+)\s*:\s*([^;]+);/gm;
const VAR_REFERENCE = /var\((--[a-z0-9-]+)\)/g;
const OKLCH_LITERAL =
  /^oklch\(\s*([\d.]+)%\s+((?:calc\([^)]*\))|[\d.]+)\s+([\d.]+)\s*\)$/;
const CALC_STEP = /^calc\(\s*([\d.]+)\s*([*/])\s*([\d.]+)\s*\)$/;
const HEX_LITERAL = /^#([0-9a-f]{6}|[0-9a-f]{3})$/i;

export async function readTokenDeclarations(): Promise<Declarations> {
  const source = await readFile(TOKENS_PATH, "utf8");
  const declarations = new Map<string, string>();
  for (const match of source.matchAll(DECLARATION)) {
    const [, name, value] = match;
    if (name !== undefined && value !== undefined) {
      declarations.set(name, value.replace(/\s+/g, " ").trim());
    }
  }
  return declarations;
}

/** A percentage token as a 0 to 1 share. */
export function readShare(declarations: Declarations, name: string): number {
  const raw = declarations.get(name);
  if (raw === undefined || !raw.endsWith("%")) {
    throw new Error(`${name} is not a percentage token`);
  }

  return Number(raw.slice(0, -1)) / 100;
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

export function decodeChannel(encoded: number): number {
  return encoded <= 0.04045
    ? encoded / 12.92
    : ((encoded + 0.055) / 1.055) ** 2.4;
}

export function parseColor(value: string): Rgb {
  const hex = HEX_LITERAL.exec(value);
  if (hex?.[1] !== undefined) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, "$&$&") : hex[1];
    const packed = Number.parseInt(digits, 16);
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

export async function resolvePalette(): Promise<(name: string) => Rgb> {
  const declarations = await readTokenDeclarations();
  return (name) => parseColor(resolveTokenValue(declarations, name));
}
