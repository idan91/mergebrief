import { fileURLToPath } from "node:url";

import { compile } from "sass";
import { describe, expect, it } from "vitest";

const STYLES_DIRECTORY = fileURLToPath(
  new URL("../../../styles", import.meta.url),
);

function compileSheet(relativePath: string): string {
  const path = fileURLToPath(new URL(relativePath, import.meta.url));
  return compile(path, { loadPaths: [STYLES_DIRECTORY] }).css;
}

/** The declarations of the first compiled rule whose selector is `selector`. */
function readDeclarations(css: string, selector: string): Map<string, string> {
  const start = css.indexOf(`${selector} {`);
  const body = css.slice(start + selector.length + 2, css.indexOf("}", start));
  const declarations = new Map<string, string>();
  for (const declaration of body.split(";")) {
    const [property, value] = declaration.split(/:(.*)/s);
    if (property !== undefined && value !== undefined) {
      declarations.set(property.trim(), value.trim());
    }
  }
  return declarations;
}

describe("SuggestionCard stylesheet", () => {
  it("hands the phone number cells the card's own line box", () => {
    const row = readDeclarations(
      compileSheet("./SuggestionCard.module.scss"),
      ".suggestionDiff tbody tr",
    );
    const phoneNumber = readDeclarations(
      compileSheet("../../DiffRows/DiffRows.module.scss"),
      ".line > .lineNumber",
    );

    expect(row.get("--diff-line-box")).toBe(
      `calc(var(--font-size-md) * ${String(row.get("line-height"))})`,
    );
    expect(phoneNumber.get("line-height")).toBe("var(--diff-line-box)");
  });
});
