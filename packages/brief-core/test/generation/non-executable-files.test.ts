import { describe, expect, it } from "vitest";
import { dropNoTestsOnNonExecutableFiles } from "../../src/generation/non-executable-files";
import { RiskSurfaceAttributes } from "../../src/types";

const NO_TESTS = RiskSurfaceAttributes.NO_TESTS;
const EXTERNAL_IO = RiskSurfaceAttributes.EXTERNAL_IO;
const HOT_PATH = RiskSurfaceAttributes.HOT_PATH;

interface TestChunk {
  id: string;
  file: string;
  riskSurface: string[];
  riskNotes?: { attr: string; note: string }[] | undefined;
}

function makeChunk(
  file: string,
  riskSurface: string[] = [NO_TESTS],
  riskNotes?: TestChunk["riskNotes"],
): TestChunk {
  const chunk: TestChunk = { id: `c-${file}`, file, riskSurface };
  if (riskNotes !== undefined) {
    chunk.riskNotes = riskNotes;
  }
  return chunk;
}

function readRiskSurface(file: string): string[] {
  const [chunk] = dropNoTestsOnNonExecutableFiles([makeChunk(file)]);
  return chunk?.riskSurface ?? [];
}

describe("dropNoTestsOnNonExecutableFiles", () => {
  it.each([
    "src/app.css",
    "src/Button/Button.scss",
    "src/legacy.sass",
    "src/theme.less",
    "README.md",
    "docs/guide.markdown",
    "assets/logo.svg",
    "public/index.html",
    "public/legacy.htm",
    "assets/hero.png",
    "assets/photo.jpg",
    "assets/photo.jpeg",
    "assets/spinner.gif",
    "assets/hero.webp",
    "assets/hero.avif",
    "public/favicon.ico",
    "assets/scan.bmp",
    "assets/scan.tif",
    "assets/scan.tiff",
    "fonts/inter.woff",
    "fonts/inter.woff2",
    "fonts/inter.ttf",
    "fonts/inter.otf",
    "fonts/inter.eot",
    "media/chime.mp3",
    "media/chime.wav",
    "media/chime.ogg",
    "media/intro.mp4",
    "media/intro.webm",
    "media/intro.mov",
    "docs/spec.pdf",
  ])("drops no-tests on %s", (file) => {
    expect(readRiskSurface(file)).toEqual([]);
  });

  it.each([
    "docs/intro.mdx",
    "src/App.vue",
    "src/index.ts",
    "src/index.test.ts",
    "src/theme.css.ts",
    "src/styles.css/index.ts",
    "Makefile",
    ".gitignore",
  ])("keeps no-tests on %s", (file) => {
    expect(readRiskSurface(file)).toEqual([NO_TESTS]);
  });

  it("drops no-tests on a compound or upper-case extension", () => {
    expect(readRiskSurface("src/Button.module.scss")).toEqual([]);
    expect(readRiskSurface("src/STYLES.SCSS")).toEqual([]);
  });

  it("keeps other attributes and notes in order", () => {
    const chunk = makeChunk(
      "src/app.scss",
      [EXTERNAL_IO, NO_TESTS, HOT_PATH],
      [
        { attr: EXTERNAL_IO, note: "loads a font from a CDN" },
        { attr: NO_TESTS, note: "no style test" },
        { attr: HOT_PATH, note: "every page imports it" },
      ],
    );

    const [result] = dropNoTestsOnNonExecutableFiles([chunk]);

    expect(result?.riskSurface).toEqual([EXTERNAL_IO, HOT_PATH]);
    expect(result?.riskNotes).toEqual([
      { attr: EXTERNAL_IO, note: "loads a font from a CDN" },
      { attr: HOT_PATH, note: "every page imports it" },
    ]);
  });

  it("deletes riskNotes once the no-tests note was the only one", () => {
    const chunk = makeChunk(
      "README.md",
      [NO_TESTS],
      [{ attr: NO_TESTS, note: "no doc test" }],
    );

    const [result] = dropNoTestsOnNonExecutableFiles([chunk]);

    expect(result?.riskSurface).toEqual([]);
    expect(result).not.toHaveProperty("riskNotes");
  });

  it("drops a no-tests note even when riskSurface lacks no-tests", () => {
    const chunk = makeChunk(
      "src/app.css",
      [HOT_PATH],
      [
        { attr: NO_TESTS, note: "stray note" },
        { attr: HOT_PATH, note: "every page imports it" },
      ],
    );

    const [result] = dropNoTestsOnNonExecutableFiles([chunk]);

    expect(result?.riskSurface).toEqual([HOT_PATH]);
    expect(result?.riskNotes).toEqual([
      { attr: HOT_PATH, note: "every page imports it" },
    ]);
  });

  it("returns a chunk with nothing to drop as the same object", () => {
    const styled = makeChunk("src/app.css", [HOT_PATH]);
    const code = makeChunk("src/index.ts");

    const result = dropNoTestsOnNonExecutableFiles([styled, code]);

    expect(result[0]).toBe(styled);
    expect(result[1]).toBe(code);
  });

  it("does not mutate the input chunk", () => {
    const chunk = makeChunk(
      "src/app.css",
      [NO_TESTS],
      [{ attr: NO_TESTS, note: "no style test" }],
    );
    const before = structuredClone(chunk);

    dropNoTestsOnNonExecutableFiles([chunk]);

    expect(chunk).toEqual(before);
  });
});
