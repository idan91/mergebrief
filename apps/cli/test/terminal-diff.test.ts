import { describe, expect, it } from "vitest";
import {
  isTerminalColorEnabled,
  renderTerminalDiff,
} from "../src/commands/read/terminal-diff";

const GREEN = "\u001B[32m";
const RED = "\u001B[31m";
const CYAN = "\u001B[36m";
const BOLD = "\u001B[1m";
const RESET = "\u001B[0m";

const HEADER = "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n";

function paintHeader(): string {
  return (
    `${BOLD}diff --git a/a.ts b/a.ts${RESET}\n` +
    `${BOLD}--- a/a.ts${RESET}\n` +
    `${BOLD}+++ b/a.ts${RESET}\n`
  );
}

describe("renderTerminalDiff with color", () => {
  it("paints headers, hunk lines, added and removed lines", () => {
    const text = `${HEADER}@@ -1,2 +1,2 @@ fn\n keep\n-old\n+new\n`;

    expect(renderTerminalDiff(text, { color: true })).toBe(
      `${paintHeader()}${CYAN}@@ -1,2 +1,2 @@ fn${RESET}\n keep\n` +
        `${RED}-old${RESET}\n${GREEN}+new${RESET}\n`,
    );
  });

  it("reads a removed line starting with dashes as removed", () => {
    const text = `${HEADER}@@ -1,2 +1 @@\n--- not a header\n-- also removed\n+new\n`;

    expect(renderTerminalDiff(text, { color: true })).toBe(
      `${paintHeader()}${CYAN}@@ -1,2 +1 @@${RESET}\n` +
        `${RED}--- not a header${RESET}\n${RED}-- also removed${RESET}\n` +
        `${GREEN}+new${RESET}\n`,
    );
  });

  it("reads an added line starting with plus signs as added", () => {
    const text = `${HEADER}@@ -0,0 +1 @@\n+++ not a header\n`;

    expect(renderTerminalDiff(text, { color: true })).toBe(
      `${paintHeader()}${CYAN}@@ -0,0 +1 @@${RESET}\n` +
        `${GREEN}+++ not a header${RESET}\n`,
    );
  });

  it("reads the next file's header after a hunk ends", () => {
    const text = `${HEADER}@@ -1 +1 @@\n-a\n+b\n${HEADER}`;

    expect(renderTerminalDiff(text, { color: true })).toBe(
      `${paintHeader()}${CYAN}@@ -1 +1 @@${RESET}\n${RED}-a${RESET}\n` +
        `${GREEN}+b${RESET}\n${paintHeader()}`,
    );
  });

  it("leaves the no-newline marker outside the hunk counts", () => {
    const text = `${HEADER}@@ -1 +1 @@\n-a\n\\ No newline at end of file\n+b\n`;

    expect(renderTerminalDiff(text, { color: true })).toBe(
      `${paintHeader()}${CYAN}@@ -1 +1 @@${RESET}\n${RED}-a${RESET}\n` +
        `\\ No newline at end of file\n${GREEN}+b${RESET}\n`,
    );
  });
});

describe("renderTerminalDiff escaping", () => {
  const injected = `${HEADER}@@ -0,0 +1 @@\n+evil()\u001B[2K\u001B[1A\n`;

  it("escapes a planted erase sequence with color off", () => {
    const rendered = renderTerminalDiff(injected, { color: false });

    expect(rendered).toBe(
      `${HEADER}@@ -0,0 +1 @@\n+evil()[U+001B][2K[U+001B][1A\n`,
    );
  });

  it("escapes a planted sequence under the color's own codes", () => {
    const rendered = renderTerminalDiff(injected, { color: true });

    expect(rendered).toContain(
      `${GREEN}+evil()[U+001B][2K[U+001B][1A${RESET}\n`,
    );
  });

  it("escapes a planted sequence in a file header", () => {
    const rendered = renderTerminalDiff("diff --git a/\u001B[2K b/x\n", {
      color: false,
    });

    expect(rendered).toBe("diff --git a/[U+001B][2K b/x\n");
  });

  it("keeps the carriage return that ends a CRLF line", () => {
    const text = `${HEADER}@@ -0,0 +1 @@\n+line\r\n`;

    expect(renderTerminalDiff(text, { color: true })).toContain(
      `${GREEN}+line${RESET}\r\n`,
    );
  });

  it("keeps a last line with no newline from being overwritten", () => {
    const text = `${HEADER}@@ -0,0 +1 @@\n+evil()\r`;

    expect(renderTerminalDiff(text, { color: false })).toBe(
      `${HEADER}@@ -0,0 +1 @@\n+evil()\r\n`,
    );
  });

  it("ends a diff with no final newline on its own line", () => {
    expect(renderTerminalDiff("diff --git a/x b/x", { color: false })).toBe(
      "diff --git a/x b/x\n",
    );
  });

  it("leaves an empty diff empty", () => {
    expect(renderTerminalDiff("", { color: true })).toBe("");
  });

  it("returns a plain diff unchanged with color off", () => {
    const text = `${HEADER}@@ -1 +1 @@\n-a\n+\tb\n`;

    expect(renderTerminalDiff(text, { color: false })).toBe(text);
  });
});

describe("isTerminalColorEnabled", () => {
  it.each([
    [{}, true],
    [{ TERM: "xterm-256color" }, true],
    [{ NO_COLOR: "" }, true],
    [{ NO_COLOR: "1" }, false],
    [{ TERM: "dumb" }, false],
  ])("reads %j as %s", (env, expected) => {
    expect(isTerminalColorEnabled(env)).toBe(expected);
  });
});
