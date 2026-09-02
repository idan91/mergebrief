import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { TABLET_BREAKPOINT_PX } from "../hooks/useViewportBoundary";

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
});
