// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { DiffTableHead } from ".";

afterEach(cleanup);

function readCaption(file: string): string | null {
  const { container } = render(
    <table>
      <DiffTableHead file={file} overlayActive={false} split={false} />
    </table>,
  );
  return container.querySelector("caption")?.textContent ?? null;
}

describe("DiffTableHead", () => {
  it("captions a path with a bidi override by a visible escape", () => {
    expect(readCaption("src/\u202Etxt.exe")).toBe(
      "Diff for src/[U+202E]txt.exe",
    );
  });

  it("captions an RTL path as it is", () => {
    expect(readCaption("docs/שלום.md")).toBe("Diff for docs/שלום.md");
  });
});
