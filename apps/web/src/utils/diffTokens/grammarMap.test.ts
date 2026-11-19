import { describe, expect, it } from "vitest";

import { resolveGrammar } from "./grammarMap";
import { GrammarNames, type GrammarName } from "./types";

const CASES: [string, GrammarName][] = [
  ["src/app.ts", GrammarNames.TYPESCRIPT],
  ["analysis/model.R", GrammarNames.R],
];

const BASENAME_CASES: [string, GrammarName][] = [
  ["Dockerfile", GrammarNames.DOCKER],
  ["apps/api/Dockerfile", GrammarNames.DOCKER],
  ["Dockerfile.dev", GrammarNames.DOCKER],
  ["Makefile", GrammarNames.MAKE],
  [".gitignore", GrammarNames.INI],
  [".env", GrammarNames.DOTENV],
  [".env.example", GrammarNames.DOTENV],
  ["apps/web/.env.local", GrammarNames.DOTENV],
];

describe("resolveGrammar", () => {
  it.each(CASES)("maps %s to %s", (filePath, grammar) => {
    expect(resolveGrammar(filePath)).toBe(grammar);
  });

  it.each(BASENAME_CASES)("maps %s to %s", (filePath, grammar) => {
    expect(resolveGrammar(filePath)).toBe(grammar);
  });

  it("reads the last extension and treats .example as unknown", () => {
    expect(resolveGrammar("src/a.module.scss")).toBe(GrammarNames.SCSS);
    expect(resolveGrammar("config/settings.example")).toBeUndefined();
  });

  it("returns nothing for an extension it does not know", () => {
    expect(resolveGrammar("assets/photo.png")).toBeUndefined();
    expect(resolveGrammar("pnpm-lock.yaml.bak")).toBeUndefined();
    expect(resolveGrammar("LICENSE")).toBeUndefined();
    expect(resolveGrammar("go.mod")).toBeUndefined();
    expect(resolveGrammar("go.sum")).toBeUndefined();
    expect(resolveGrammar("app/models/user.rb")).toBeUndefined();
    expect(resolveGrammar("")).toBeUndefined();
  });

  it("leaves a Blade template plain rather than reading it as PHP", () => {
    expect(resolveGrammar("resources/views/welcome.blade.php")).toBeUndefined();
    expect(resolveGrammar("views/Layout.BLADE.PHP")).toBeUndefined();
  });

  it("ignores directory names when matching a basename rule", () => {
    expect(resolveGrammar("Dockerfile/notes.txt")).toBeUndefined();
  });

  it("matches basenames regardless of case", () => {
    expect(resolveGrammar("services/api/dockerfile")).toBe(GrammarNames.DOCKER);
    expect(resolveGrammar("MAKEFILE")).toBe(GrammarNames.MAKE);
    expect(resolveGrammar("app/.ENV.local")).toBe(GrammarNames.DOTENV);
  });

  it("never resolves a prototype key as a grammar", () => {
    expect(resolveGrammar("constructor")).toBeUndefined();
    expect(resolveGrammar("x.toString")).toBeUndefined();
    expect(resolveGrammar("lib/__proto__")).toBeUndefined();
  });
});
