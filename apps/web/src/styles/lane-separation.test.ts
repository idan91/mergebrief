import { describe, expect, it } from "vitest";

import { Concerns } from "brief-core/types";

import { decodeChannel, resolvePalette, type Rgb } from "./test-utils";

// The Four Lanes Rule (DESIGN.md): the brand owns the vermilion lane. A state
// or concern colour inside 20° of its OKLCH hue must sit clearly darker or
// clearly less saturated, or it reads as the brand.

const LANE_HALF_WIDTH_DEGREES = 20;
const DARKER_BY_MIN = 0.05;
const CHROMA_SHARE_MAX = 0.75;
const FULL_TURN_DEGREES = 360;
const HALF_TURN_DEGREES = 180;
const VERMILION_HUE_DEGREES = 31;
const HUE_TOLERANCE_DEGREES = 5;

const LANE_NEIGHBOURS = [
  "--color-positive",
  "--color-negative",
  "--color-warning",
  "--color-merged",
  ...Object.values(Concerns).map((concern) => `--color-concern-${concern}`),
];

interface Oklch {
  readonly lightness: number;
  readonly chroma: number;
  readonly hue: number;
}

function convertSrgbToOklch(rgb: Rgb): Oklch {
  const [red, green, blue] = rgb.map((channel) => decodeChannel(channel / 255));
  if (red === undefined || green === undefined || blue === undefined) {
    throw new Error("an sRGB colour has three channels");
  }
  const longCone = Math.cbrt(
    0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue,
  );
  const mediumCone = Math.cbrt(
    0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue,
  );
  const shortCone = Math.cbrt(
    0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue,
  );
  const lightness =
    0.2104542553 * longCone +
    0.793617785 * mediumCone -
    0.0040720468 * shortCone;
  const labA =
    1.9779984951 * longCone -
    2.428592205 * mediumCone +
    0.4505937099 * shortCone;
  const labB =
    0.0259040371 * longCone +
    0.7827717662 * mediumCone -
    0.808675766 * shortCone;
  const degrees = (Math.atan2(labB, labA) * HALF_TURN_DEGREES) / Math.PI;

  return {
    lightness,
    chroma: Math.hypot(labA, labB),
    hue: (degrees + FULL_TURN_DEGREES) % FULL_TURN_DEGREES,
  };
}

function measureHueDistance(left: number, right: number): number {
  const apart = Math.abs(left - right) % FULL_TURN_DEGREES;

  return Math.min(apart, FULL_TURN_DEGREES - apart);
}

describe("brand lane separation", () => {
  it("keeps every state and concern colour out of the brand's lane", async () => {
    const colorOf = await resolvePalette();
    const brand = convertSrgbToOklch(colorOf("--color-brand"));
    const failures: string[] = [];

    for (const token of LANE_NEIGHBOURS) {
      const neighbour = convertSrgbToOklch(colorOf(token));
      const inLane =
        measureHueDistance(neighbour.hue, brand.hue) < LANE_HALF_WIDTH_DEGREES;
      const clearlyDarker =
        brand.lightness - neighbour.lightness >= DARKER_BY_MIN;
      const clearlyDuller = neighbour.chroma <= brand.chroma * CHROMA_SHARE_MAX;
      if (inLane && !clearlyDarker && !clearlyDuller) {
        failures.push(`${token} sits in the brand's lane`);
      }
    }

    expect(failures).toEqual([]);
  });

  it("reads the brand's own hue in the vermilion lane", async () => {
    const colorOf = await resolvePalette();
    const brand = convertSrgbToOklch(colorOf("--color-brand"));

    expect(measureHueDistance(brand.hue, VERMILION_HUE_DEGREES)).toBeLessThan(
      HUE_TOLERANCE_DEGREES,
    );
  });
});
