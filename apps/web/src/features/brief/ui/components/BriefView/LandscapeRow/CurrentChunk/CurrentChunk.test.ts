import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "sass";
import { describe, expect, it } from "vitest";

const TEST_DIR = dirname(fileURLToPath(import.meta.url));

describe("CurrentChunk styles", () => {
  it("sizes the fold and the chunk menu as 44px targets", () => {
    const { css } = compile(join(TEST_DIR, "CurrentChunk.module.scss"), {
      loadPaths: [join(TEST_DIR, "../../../../../../../styles")],
      style: "compressed",
    });

    expect(css).toContain(".current .fold,.current .menu{inline-size:2.75rem;");
    expect(css).not.toContain(".current .fold{");
  });
});
