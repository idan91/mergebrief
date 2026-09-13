import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { beforeAll, describe, expect, it } from "vitest";

import { SYNTAX_PALETTE, resolveClassId, TEXT_CLASS_ID } from "./palette";
import {
  MERGEBRIEF_DARK,
  MERGEBRIEF_THEME_NAME,
  listThemeForegrounds,
} from "./theme";

const SAMPLE = [
  "// a note",
  'import { alpha, beta as gamma } from "./mod";',
  "const options = { keyOne: alpha };",
  'const el = <Button title="hi" disabled />;',
].join("\n");

let highlighter: HighlighterCore;

function findSampleToken(matches: (content: string) => boolean): {
  color?: string;
} {
  const lines = highlighter.codeToTokensBase(SAMPLE, {
    lang: "tsx",
    theme: MERGEBRIEF_THEME_NAME,
  });
  const token = lines.flat().find((candidate) => matches(candidate.content));

  if (token === undefined) throw new Error("no token matched the sample");

  return token;
}

function readSampleClassId(content: string): number {
  return resolveClassId(
    findSampleToken((candidate) => candidate.trim() === content).color,
  );
}

function readSampleClassIdStartingWith(prefix: string): number {
  return resolveClassId(
    findSampleToken((candidate) => candidate.startsWith(prefix)).color,
  );
}

function resolvePaletteClassId(token: string): number {
  const index = SYNTAX_PALETTE.findIndex(
    (candidate) => candidate.token === token,
  );
  if (index < 0) throw new Error(`no palette entry named ${token}`);

  return index;
}

beforeAll(async () => {
  highlighter = await createHighlighterCore({
    themes: [MERGEBRIEF_DARK],
    langs: [import("shiki/langs/tsx.mjs")],
    engine: createJavaScriptRegexEngine(),
  });
});

describe("mergebrief dark theme", () => {
  it("carries our own name", () => {
    expect(MERGEBRIEF_DARK.name).toBe(MERGEBRIEF_THEME_NAME);
  });

  it("resolves every foreground it can emit to a palette class", () => {
    for (const hex of listThemeForegrounds(MERGEBRIEF_DARK)) {
      expect(SYNTAX_PALETTE[resolveClassId(hex)]?.hex).toBe(hex);
    }
  });

  it("drops the github-dark comment grey the palette replaced", () => {
    expect(listThemeForegrounds(MERGEBRIEF_DARK)).not.toContain("#6a737d");
  });

  it("colours a comment with the AA-corrected grey", () => {
    expect(readSampleClassId("// a note")).toBe(
      resolvePaletteClassId("comment"),
    );
  });
});

describe("theme scope overrides", () => {
  it("colours an object literal key away from plain text", () => {
    expect(readSampleClassId("keyOne")).toBe(resolvePaletteClassId("constant"));
  });

  it("keeps the key-value colon at plain text", () => {
    expect(readSampleClassIdStartingWith(":")).toBe(TEXT_CLASS_ID);
  });

  it("colours an import specifier away from plain text", () => {
    expect(readSampleClassId("alpha")).toBe(resolvePaletteClassId("constant"));
  });

  it("colours a renamed import specifier too", () => {
    expect(readSampleClassId("gamma")).toBe(resolvePaletteClassId("constant"));
  });

  it("colours a jsx attribute name away from plain text", () => {
    expect(readSampleClassId("title")).toBe(resolvePaletteClassId("tag"));
  });

  it("colours a valueless jsx attribute name too", () => {
    expect(readSampleClassId("disabled")).toBe(resolvePaletteClassId("tag"));
  });
});
