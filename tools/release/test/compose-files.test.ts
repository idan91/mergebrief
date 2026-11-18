import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPOSE_PATHS } from "../src/consts";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const EXTERNAL_DATABASE_OVERLAY = "docker-compose.external-db.yml";
const IMAGE_LINE = /^\s*image:/;

function readSettingLines(file: string): readonly string[] {
  return readFileSync(join(REPO_ROOT, file), "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "" && !line.trim().startsWith("#"));
}

describe("the compose files a release ships", () => {
  it("pin the image in every file the stamp edits", () => {
    for (const file of COMPOSE_PATHS) {
      const pinsAnImage = readSettingLines(file).some((line) =>
        IMAGE_LINE.test(line),
      );
      expect(pinsAnImage).toBe(true);
    }
  });

  it("name no image in the external-database overlay", () => {
    // The stamp leaves the overlay alone, so an image named there would ship
    // on the dev tag.
    const imageLines = readSettingLines(EXTERNAL_DATABASE_OVERLAY).filter(
      (line) => IMAGE_LINE.test(line),
    );

    expect(COMPOSE_PATHS).not.toContain(EXTERNAL_DATABASE_OVERLAY);
    expect(imageLines).toEqual([]);
  });

  it("drop the bundled postgres in the overlay", () => {
    expect(readSettingLines(EXTERNAL_DATABASE_OVERLAY)).toContain(
      "  postgres: !reset null",
    );
  });
});
