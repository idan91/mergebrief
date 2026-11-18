import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/** File contents by path relative to the temp root. */
export type Tree = Readonly<Record<string, string>>;

export interface FrontMatter {
  readonly date?: string;
  readonly breaking?: string;
  readonly security?: string;
}

const DEFAULT_FRONT_MATTER: Required<FrontMatter> = {
  date: "2026-10-03",
  breaking: "false",
  security: "false",
};

export function makeTempRoot(): string {
  return mkdtempSync(join(tmpdir(), "release-"));
}

export function writeTree(root: string, tree: Tree): void {
  for (const [path, content] of Object.entries(tree)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content);
  }
}

/** One notes file's text: front matter lines in the given order, then the body. */
export function makeNotesFile(frontMatter: FrontMatter, body: string): string {
  const merged = { ...DEFAULT_FRONT_MATTER, ...frontMatter };
  const lines = Object.entries(merged).map(
    ([key, value]) => `${key}: ${value}`,
  );
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

/** A notes dir under a temp root; returns the dir path. */
export function makeNotesDir(files: Readonly<Record<string, string>>): string {
  const root = makeTempRoot();
  const dir = join(root, "docs", "releases");
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content);
  }
  return dir;
}
