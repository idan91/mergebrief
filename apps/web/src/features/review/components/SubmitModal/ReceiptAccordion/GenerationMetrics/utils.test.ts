import { createI18n } from "i18n";
import { describe, expect, it } from "vitest";

import { formatShortenedLine } from "./utils";

const t = createI18n().t;

describe("formatShortenedLine", () => {
  it("names each read-as kind with its count", () => {
    const line = formatShortenedLine(t, [
      { file: "pnpm-lock.yaml", readAs: "package-summary" },
      { file: "yarn.lock", readAs: "package-summary" },
      { file: "dist/app.js", readAs: "counts-only" },
    ]);

    expect(line).toBe("2 files as package changes · 1 file as counts only");
  });

  it("leaves out a kind with no file", () => {
    const line = formatShortenedLine(t, [
      { file: "dist/app.js", readAs: "counts-only" },
    ]);

    expect(line).toBe("1 file as counts only");
  });

  it("is absent when no file was shortened", () => {
    expect(formatShortenedLine(t, [])).toBeUndefined();
  });
});
