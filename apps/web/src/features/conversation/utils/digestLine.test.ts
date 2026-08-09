// One-liner derivation spec: strip markdown to plain text → first non-empty
// line → cap ~80ch → fallback for code-only bodies.
import { describe, expect, it } from "vitest";
import { deriveDigestLine } from "./digestLine";

const CODERABBIT_WALKTHROUGH = `## Walkthrough

The changes introduce a new GraphQL primitive to the github package. The
query fetches review threads with resolution state.

## Changes

| File | Summary |
|---|---|
| conversation.ts | new primitive |
`;

describe("deriveDigestLine", () => {
  it("skips markdown headings and uses the first prose line (CodeRabbit walkthrough)", () => {
    const line = deriveDigestLine(CODERABBIT_WALKTHROUGH);
    expect(
      line.startsWith("The changes introduce a new GraphQL primitive"),
    ).toBe(true);
    expect(line).not.toContain("Walkthrough");
    expect(line).not.toContain("#");
  });

  it("skips table rows (no pipe garbage in the digest)", () => {
    const tableOnly =
      "## Changes\n\n| File | Summary |\n|---|---|\n| a.ts | new |\n";
    expect(deriveDigestLine(tableOnly)).toBe("suggested change");
  });

  it("returns a plain human sentence untouched", () => {
    expect(deriveDigestLine("This null check looks inverted.")).toBe(
      "This null check looks inverted.",
    );
  });

  it("falls back for a code-only body (suggestion block)", () => {
    expect(deriveDigestLine("```suggestion\nconst x = 2;\n```")).toBe(
      "suggested change",
    );
  });

  it("falls back for an empty or whitespace body", () => {
    expect(deriveDigestLine("")).toBe("suggested change");
    expect(deriveDigestLine("  \n\n  ")).toBe("suggested change");
  });

  it("strips emphasis, inline code, links, and quote markers", () => {
    expect(
      deriveDigestLine(
        "> **Note:** use `Number.isSafeInteger` — see [docs](https://x.test)",
      ),
    ).toBe("Note: use Number.isSafeInteger — see docs");
  });

  it("caps at ~80 chars on the first line only", () => {
    const long = `${"a".repeat(100)}\nsecond line`;
    const line = deriveDigestLine(long);
    expect(line.length).toBeLessThanOrEqual(81);
    expect(line.endsWith("…")).toBe(true);
  });

  it("keeps intraword underscores (identifiers are not emphasis)", () => {
    expect(deriveDigestLine("rename user_id to account_id")).toBe(
      "rename user_id to account_id",
    );
  });

  it("falls back for a 4-space-indented code-only body", () => {
    expect(deriveDigestLine("    const x = 1;\n    const y = 2;")).toBe(
      "suggested change",
    );
  });

  it("drops a leading-pipe-less table header (separator-aware)", () => {
    const table = "File | Summary\n--- | ---\na.ts | new\n\nProse after table.";
    expect(deriveDigestLine(table)).toBe("Prose after table.");
  });

  it("drops pipe-less body rows after a leading-pipe separator (|---|---|)", () => {
    const table = "| File | Summary |\n|---|---|\na.ts | new\n\nProse after.";
    expect(deriveDigestLine(table)).toBe("Prose after.");
  });

  it("does not let a horizontal rule open table mode (prose with a pipe survives)", () => {
    expect(deriveDigestLine("---\nUse A | B for the join")).toBe(
      "Use A | B for the join",
    );
  });

  it("drops a Setext heading (text + dashed underline) like an ATX one", () => {
    expect(deriveDigestLine("Walkthrough\n---\nActual point here.")).toBe(
      "Actual point here.",
    );
    expect(deriveDigestLine("Walkthrough\n===\nActual point here.")).toBe(
      "Actual point here.",
    );
  });

  it("applies structural filters inside blockquotes (quoted walkthrough)", () => {
    expect(deriveDigestLine("> ## Walkthrough\n> Real point here.")).toBe(
      "Real point here.",
    );
  });

  it("keeps pipe-leading prose when no separator established a table", () => {
    expect(deriveDigestLine("| undefined should be handled here")).toBe(
      "| undefined should be handled here",
    );
  });

  it("drops pipe-less rows while a table is open (GFM: until a blank line)", () => {
    const table = "| File | Summary |\n|---|---|\na.ts\n\nProse after.";
    expect(deriveDigestLine(table)).toBe("Prose after.");
  });

  it("falls back for blockquoted indented code", () => {
    expect(deriveDigestLine(">     const x = 1;")).toBe("suggested change");
  });

  it("treats 4-space-indented lines starting with > as code, not blockquotes", () => {
    expect(deriveDigestLine("    > old value")).toBe("suggested change");
  });

  it("keeps intraword double underscores too", () => {
    expect(deriveDigestLine("rename foo__bar__baz here")).toBe(
      "rename foo__bar__baz here",
    );
    expect(deriveDigestLine("__strong__ start")).toBe("strong start");
  });

  it("unwraps emphasis whose contents contain underscores", () => {
    expect(deriveDigestLine("__foo_bar__ should change")).toBe(
      "foo_bar should change",
    );
    expect(deriveDigestLine("_foo_bar_ here")).toBe("foo_bar here");
  });

  it("treats an indented fence marker as code, not a fence toggle", () => {
    expect(
      deriveDigestLine("    ```\n    const x = 1;\n    ```\nProse after."),
    ).toBe("Prose after.");
  });

  it("keeps literal spaced asterisks (not emphasis delimiters)", () => {
    expect(deriveDigestLine("Use a * b * c")).toBe("Use a * b * c");
    expect(deriveDigestLine("*emph* start")).toBe("emph start");
  });

  it("does not read an indented code line as a structural lookahead", () => {
    expect(deriveDigestLine("Use this value\n    ---")).toBe("Use this value");
  });

  it("keeps a four-backtick fence open across inner triple-backtick lines", () => {
    const body = "````\n```ts\nconst x = 1;\n```\n````\nProse after.";
    expect(deriveDigestLine(body)).toBe("Prose after.");
  });

  it("does not close a fence on an info-string line (```ts is content, not a closer)", () => {
    const body = "```markdown\ncontent\n```ts\ncode line\n```\nProse after.";
    expect(deriveDigestLine(body)).toBe("Prose after.");
  });

  it("ignores a quoted-indented next line as structure", () => {
    expect(deriveDigestLine("Use this value\n>     ---")).toBe(
      "Use this value",
    );
  });

  it("skips fenced code and picks the prose after it", () => {
    expect(
      deriveDigestLine("```ts\nconst a = 1;\n```\nActual point here."),
    ).toBe("Actual point here.");
  });
});
