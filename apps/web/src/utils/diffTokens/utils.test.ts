import { describe, expect, it } from "vitest";

import { buildSnippetKey, isChunkTokenizable } from "./utils";
import { DiffLineKinds } from "types/diff-lines";
import { type TokenizableRow } from "./types";
import { CHUNK_ROW_CEILING } from "./consts";

describe("isChunkTokenizable", () => {
  it("admits a chunk sitting on the ceiling", () => {
    expect(isChunkTokenizable(CHUNK_ROW_CEILING)).toBe(true);
  });

  it("refuses a chunk one row above the ceiling", () => {
    expect(isChunkTokenizable(CHUNK_ROW_CEILING + 1)).toBe(false);
  });

  it("refuses a chunk with no rows", () => {
    expect(isChunkTokenizable(0)).toBe(false);
  });
});

describe("buildSnippetKey", () => {
  const ROWS: TokenizableRow[] = [
    { kind: DiffLineKinds.ADD, content: "const a = 1;" },
  ];

  it("gives the same key to the same rows of the same file", () => {
    expect(buildSnippetKey("src/a.ts", ROWS)).toBe(
      buildSnippetKey("src/a.ts", [{ ...ROWS[0] } as TokenizableRow]),
    );
  });

  it("separates two snippets that differ only in content", () => {
    const other: TokenizableRow[] = [
      { kind: DiffLineKinds.ADD, content: "const a = 2;" },
    ];

    expect(buildSnippetKey("src/a.ts", ROWS)).not.toBe(
      buildSnippetKey("src/a.ts", other),
    );
  });

  it("separates two snippets that differ only in row kind", () => {
    const other: TokenizableRow[] = [
      { kind: DiffLineKinds.DEL, content: "const a = 1;" },
    ];

    expect(buildSnippetKey("src/a.ts", ROWS)).not.toBe(
      buildSnippetKey("src/a.ts", other),
    );
  });

  it("carries the file so the grammar is readable from the key", () => {
    expect(buildSnippetKey("src/a.ts", ROWS).startsWith("src/a.ts#")).toBe(
      true,
    );
  });
});
