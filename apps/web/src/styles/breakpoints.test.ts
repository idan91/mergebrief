import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  LANDSCAPE_HEIGHT_PX,
  LANDSCAPE_PHONE_QUERY,
  MOBILE_BREAKPOINT_PX,
  MOBILE_QUERY,
} from "../hooks/useMobileViewport";
import { TABLET_BREAKPOINT_PX } from "../hooks/useViewportBoundary";
import { compileScss, normalizeMediaQuery } from "../test/compiled-css";

// A media query in SCSS and a matchMedia query in TS must flip on the same
// pixel; nothing else in the toolchain compares them.
describe("breakpoints", () => {
  it("keeps the tablet breakpoint equal in SCSS and TS", async () => {
    const functions = await readFile(
      fileURLToPath(new URL("./_functions.scss", import.meta.url)),
      "utf8",
    );
    const tablet = /"tablet":\s*(\d+)px/.exec(functions)?.[1];

    expect(Number(tablet)).toBe(TABLET_BREAKPOINT_PX);
  });

  it("keeps the mobile breakpoint equal in SCSS and TS", async () => {
    const functions = await readFile(
      fileURLToPath(new URL("./_functions.scss", import.meta.url)),
      "utf8",
    );
    const mobile = /"mobile":\s*(\d+)px/.exec(functions)?.[1];

    expect(Number(mobile)).toBe(MOBILE_BREAKPOINT_PX);
  });

  it("keeps the landscape height breakpoint equal in SCSS and TS", async () => {
    const functions = await readFile(
      fileURLToPath(new URL("./_functions.scss", import.meta.url)),
      "utf8",
    );
    const landscape = /"landscape-height":\s*(\d+)px/.exec(functions)?.[1];

    expect(Number(landscape)).toBe(LANDSCAPE_HEIGHT_PX);
  });

  it("compiles the sideways mixin to the sideways matchMedia query", () => {
    const compiled = readMixinMediaQuery("for-landscape-phone");

    expect(normalizeMediaQuery(compiled)).toEqual(
      normalizeMediaQuery(LANDSCAPE_PHONE_QUERY),
    );
  });

  it("compiles the phone mixin to the phone matchMedia query", () => {
    const compiled = readMixinMediaQuery("for-phone");

    expect(normalizeMediaQuery(compiled)).toEqual(
      normalizeMediaQuery(MOBILE_QUERY),
    );
  });
});

/** The media query text a breakpoint mixin compiles to. */
function readMixinMediaQuery(mixin: string): string {
  const css = compileScss(
    `@use "mixins";\n@include mixins.${mixin} { a { color: red; } }`,
  );
  return /@media ([^{]+)\{/.exec(css)?.[1] ?? "";
}
