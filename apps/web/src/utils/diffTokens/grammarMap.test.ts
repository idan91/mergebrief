import { describe, expect, it } from "vitest";

import { resolveGrammar } from "./grammarMap";
import { GrammarNames, type GrammarName } from "./types";

const CASES: [string, GrammarName][] = [
  ["src/app.ts", GrammarNames.TYPESCRIPT],
  ["src/app.mts", GrammarNames.TYPESCRIPT],
  ["src/app.cts", GrammarNames.TYPESCRIPT],
  ["src/App.tsx", GrammarNames.TSX],
  ["src/app.js", GrammarNames.JAVASCRIPT],
  ["src/app.mjs", GrammarNames.JAVASCRIPT],
  ["src/app.cjs", GrammarNames.JAVASCRIPT],
  ["src/App.jsx", GrammarNames.JSX],
  ["src/__snapshots__/a.test.ts.snap", GrammarNames.JAVASCRIPT],
  ["src/app.css", GrammarNames.CSS],
  ["src/app.module.scss", GrammarNames.SCSS],
  ["package.json", GrammarNames.JSON],
  ["tsconfig.jsonc", GrammarNames.JSONC],
  ["README.md", GrammarNames.MARKDOWN],
  ["docs/page.mdx", GrammarNames.MDX],
  ["site/Page.astro", GrammarNames.ASTRO],
  ["db/schema.sql", GrammarNames.SQL],
  ["ci/build.yaml", GrammarNames.YAML],
  ["ci/build.yml", GrammarNames.YAML],
  ["Cargo.toml", GrammarNames.TOML],
  ["setup.ini", GrammarNames.INI],
  ["feed.xml", GrammarNames.XML],
  ["assets/logo.svg", GrammarNames.XML],
  ["index.html", GrammarNames.HTML],
  ["index.htm", GrammarNames.HTML],
  ["api/schema.graphql", GrammarNames.GRAPHQL],
  ["api/schema.gql", GrammarNames.GRAPHQL],
  ["src/App.vue", GrammarNames.VUE],
  ["bin/run.sh", GrammarNames.SHELLSCRIPT],
  ["bin/run.bash", GrammarNames.SHELLSCRIPT],
  ["bin/run.zsh", GrammarNames.SHELLSCRIPT],
  ["tools/run.py", GrammarNames.PYTHON],
  ["out/change.diff", GrammarNames.DIFF],
  ["out/change.patch", GrammarNames.DIFF],
  ["cmd/server/main.go", GrammarNames.GO],
  ["src/lib.rs", GrammarNames.RUST],
  ["src/main/java/App.java", GrammarNames.JAVA],
  ["public/index.php", GrammarNames.PHP],
  ["src/main.c", GrammarNames.C],
  ["include/stdio.h", GrammarNames.CPP],
  ["src/a.cc", GrammarNames.CPP],
  ["src/a.cpp", GrammarNames.CPP],
  ["src/a.cxx", GrammarNames.CPP],
  ["src/a.c++", GrammarNames.CPP],
  ["include/a.hh", GrammarNames.CPP],
  ["include/a.hpp", GrammarNames.CPP],
  ["include/a.hxx", GrammarNames.CPP],
  ["include/a.h++", GrammarNames.CPP],
  ["include/a.ipp", GrammarNames.CPP],
  ["include/a.inl", GrammarNames.CPP],
  ["include/a.tpp", GrammarNames.CPP],
  ["src/a.cppm", GrammarNames.CPP],
  ["src/a.ixx", GrammarNames.CPP],
  ["src/Program.cs", GrammarNames.CSHARP],
  ["src/Main.kt", GrammarNames.KOTLIN],
  ["build.gradle.kts", GrammarNames.KOTLIN],
  ["Sources/App.swift", GrammarNames.SWIFT],
];

const BASENAME_CASES: [string, GrammarName][] = [
  ["Dockerfile", GrammarNames.DOCKER],
  ["apps/api/Dockerfile", GrammarNames.DOCKER],
  ["Dockerfile.dev", GrammarNames.DOCKER],
  ["Makefile", GrammarNames.MAKE],
  ["tools/Makefile", GrammarNames.MAKE],
  [".gitignore", GrammarNames.INI],
  [".dockerignore", GrammarNames.INI],
  [".vercelignore", GrammarNames.INI],
  [".npmignore", GrammarNames.INI],
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
