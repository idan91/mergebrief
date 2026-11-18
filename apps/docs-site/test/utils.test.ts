import { describe, expect, it } from "vitest";

import { splitHref } from "../src/utils";

describe("splitHref", () => {
  it.each([
    ["compose.md", { path: "compose.md", fragment: "", hash: "" }],
    [
      "compose.md#start-ngrok",
      { path: "compose.md", fragment: "start-ngrok", hash: "#start-ngrok" },
    ],
    [
      "#start-ngrok",
      { path: "", fragment: "start-ngrok", hash: "#start-ngrok" },
    ],
    ["compose.md#", { path: "compose.md", fragment: "", hash: "#" }],
  ])("splits %s at its first #", (href, expected) => {
    expect(splitHref(href)).toEqual({ ok: true, value: expected });
  });

  it("decodes both parts and keeps the fragment as written in hash", () => {
    expect(splitHref("../my%20dev/loop.md#%C3%BCber-uns")).toEqual({
      ok: true,
      value: {
        path: "../my dev/loop.md",
        fragment: "über-uns",
        hash: "#%C3%BCber-uns",
      },
    });
  });

  it("keeps a second # inside the fragment", () => {
    expect(splitHref("page.md#a#b")).toEqual({
      ok: true,
      value: { path: "page.md", fragment: "a#b", hash: "#a#b" },
    });
  });

  it.each(["../vocabulary/%E0%A4%A.md", "page.md#%E0%A4%A"])(
    "refuses the malformed escape in %s",
    (href) => {
      expect(splitHref(href)).toEqual({ ok: false, error: undefined });
    },
  );
});
