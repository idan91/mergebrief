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
const PAGE_STYLESHEET = fileURLToPath(
  new URL("../BriefView.module.scss", import.meta.url),
);

function readTokenMs(tokens: string, name: string): number {
  const value = new RegExp(`${name}:\\s*(\\d+)ms;`).exec(tokens)?.[1];

  return Number(value);
}

describe("Sidebar slide timers", () => {
  it("end the slide on the motion tokens it runs on", async () => {
    const tokens = await readFile(TOKEN_STYLESHEET, "utf8");

    expect(readTokenMs(tokens, "--motion-slide")).toBe(SIDEBAR_SLIDE_IN_MS);
    expect(readTokenMs(tokens, "--motion-base")).toBe(SIDEBAR_SLIDE_OUT_MS);
  });

  it("slide in on --motion-slide and out on --motion-base", async () => {
    const page = await readFile(PAGE_STYLESHEET, "utf8");

    expect(page).toMatch(
      /data-sidebar-slide="in"\]\) \{\s+--sidebar-slide: var\(--motion-slide\);/,
    );
    expect(page).toMatch(
      /data-sidebar-slide="out"\]\) \{\s+--sidebar-slide: var\(--motion-base\);/,
    );
  });

  it("move the sidebar and the page column on one duration and curve", async () => {
    const sidebar = await readFile(SIDEBAR_STYLESHEET, "utf8");
    const page = await readFile(PAGE_STYLESHEET, "utf8");

    expect(sidebar).toContain(
      "transition: inline-size var(--sidebar-slide) var(--ease-out);",
    );
    expect(page).toContain(
      "padding-inline-end var(--sidebar-slide) var(--ease-out);",
    );
  });
});
