import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { SIDEBAR_SLIDE_IN_MS, SIDEBAR_SLIDE_OUT_MS } from "./consts";

const TOKEN_STYLESHEET = fileURLToPath(
  new URL("../../../../../../styles/tokens.scss", import.meta.url),
);
const SIDEBAR_STYLESHEET = fileURLToPath(
  new URL("./Sidebar.module.scss", import.meta.url),
);

function readTokenMs(tokens: string, name: string): number {
  const value = new RegExp(`${name}:\\s*(\\d+)ms;`).exec(tokens)?.[1];

  return Number(value);
}

describe("Sidebar slide timers", () => {
  it("end the slide on the motion tokens the panel transitions on", async () => {
    const tokens = await readFile(TOKEN_STYLESHEET, "utf8");

    expect(readTokenMs(tokens, "--motion-base")).toBe(SIDEBAR_SLIDE_IN_MS);
    expect(readTokenMs(tokens, "--motion-fast")).toBe(SIDEBAR_SLIDE_OUT_MS);
  });

  it("slide the panel in on --motion-base and out on --motion-fast", async () => {
    const sidebar = await readFile(SIDEBAR_STYLESHEET, "utf8");

    expect(sidebar).toContain(
      "transition: transform var(--motion-fast) var(--ease-out);",
    );
    expect(sidebar).toContain("transition-duration: var(--motion-base);");
    expect(sidebar).toContain(
      "transition: inline-size 0s linear var(--motion-fast);",
    );
  });
});
