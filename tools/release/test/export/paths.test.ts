import { describe, expect, it } from "vitest";
import { classifyTrackedPaths } from "../../src/logic/export/classify";
import { EXPORT_PATHS } from "../../src/logic/export/paths";
import { runGit } from "../helpers";

const SEPARATOR = "/";
const NUL = "\0";

function readFirstSegment(prefix: string): string {
  const slash = prefix.indexOf(SEPARATOR);
  return prefix.slice(0, slash + 1);
}

describe("the export manifest", () => {
  it("holds every exclude prefix under an included or private dir", () => {
    const include: readonly string[] = EXPORT_PATHS.include;
    const stray = EXPORT_PATHS.exclude.filter((prefix) => {
      const top = readFirstSegment(prefix);
      const isTopLevelPrivateDir = top === prefix;
      const isStray = !isTopLevelPrivateDir && !include.includes(top);
      return isStray;
    });

    expect(stray).toEqual([]);
  });

  it("never includes a top-level dir it also excludes", () => {
    const exclude: readonly string[] = EXPORT_PATHS.exclude;
    const both = EXPORT_PATHS.include.filter((entry) =>
      exclude.includes(entry),
    );

    expect(both).toEqual([]);
  });

  it("names the private dirs, eval splits and private-only workflows", () => {
    expect(EXPORT_PATHS.exclude).toEqual(
      expect.arrayContaining([
        ".claude/",
        ".serena/",
        "docs/internal/",
        "docs/plans/",
        "tools/categorizer/.mergebrief/",
        "tools/categorizer/eval/private-cases/",
        "tools/categorizer/eval/private-pair-cases/",
        ".github/workflows/eval-presence.yml",
        ".github/workflows/publish.yml",
      ]),
    );
  });

  it("classifies every path this repository tracks at HEAD", () => {
    const listed = runGit(import.meta.dirname, [
      "ls-tree",
      "-r",
      "-z",
      "--full-tree",
      "--name-only",
      "HEAD",
    ]);
    const tracked = listed.split(NUL).filter((path) => path.length > 0);

    const result = classifyTrackedPaths(tracked);

    const unclassified = result.ok ? [] : result.error.unclassified;
    expect(unclassified).toEqual([]);
  });
});
