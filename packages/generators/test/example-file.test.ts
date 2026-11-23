import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadGeneratorConfigFile } from "../src/config/loader";

const EXAMPLE_FILE = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "mergebrief.config.example.yaml",
);
const OPERATOR_PLACEHOLDER = "<your-github-user-id>";
const BLOCK_HEADER = /^# ([a-zA-Z]+):$/;
const BLOCK_LINE = "#   ";
/** A line that opens with a key, under any depth of commenting. */
const KEY_LINE = /^(?:- )?([A-Za-z]+):(?: |$)/;
/** Keys that only hold other keys, so they carry no value of their own. */
const MAPPING_KEYS = new Set([
  "allowed",
  "generator",
  "timeouts",
  "spend",
  "drafts",
  "triggerConditions",
  "any",
  "trackers",
  "contextSources",
  "retention",
  "audit",
  "updateCheck",
  "attachments",
  "linkFetch",
]);
const VALUE_TAG = /# (default|required|example; (default \S.*|no default))$/;
/** Blocks whose example needs a real id or a credential to load. */
const BLOCKS_NEEDING_REAL_VALUES = ["allowed", "trackers", "contextSources"];

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function readExample(): string {
  return readFileSync(EXAMPLE_FILE, "utf8");
}

/** The example as an operator leaves it after uncommenting every block that needs no real value. */
function uncommentBlocks(example: string): string {
  const lines: string[] = [];
  let insideBlock = false;

  for (const line of example.split("\n")) {
    const header = BLOCK_HEADER.exec(line)?.[1];
    if (header !== undefined) {
      insideBlock = !BLOCKS_NEEDING_REAL_VALUES.includes(header);
    } else if (!line.startsWith(BLOCK_LINE) && line.trim() !== "#") {
      insideBlock = false;
    }
    lines.push(insideBlock ? line.slice(2) : line);
  }
  return lines.join("\n");
}

function loadText(
  contents: string,
): ReturnType<typeof loadGeneratorConfigFile> {
  const dir = mkdtempSync(join(tmpdir(), "mergebrief-example-"));
  tempDirs.push(dir);
  const path = join(dir, "mergebrief.config.yaml");
  writeFileSync(path, contents);
  return loadGeneratorConfigFile(path);
}

/** Every line of the example that sets a value or a list, with its comment markers stripped. */
function listValueLines(example: string): string[] {
  return example
    .split("\n")
    .map((line) => line.replace(/^(#\s*)+/, "").trim())
    .filter((line) => {
      const key = KEY_LINE.exec(line)?.[1];
      return key !== undefined && !MAPPING_KEYS.has(key);
    });
}

describe("mergebrief.config.example.yaml", () => {
  it("tags every value as the default, an example or required", () => {
    const valueLines = listValueLines(readExample());
    const untagged = valueLines.filter((line) => !VALUE_TAG.test(line));

    expect(valueLines.length).toBeGreaterThan(30);
    expect(untagged).toEqual([]);
  });

  it("refuses boot as shipped, on the operators placeholder alone", () => {
    const result = loadText(readExample());
    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.issues).toEqual([
      "operators: 0: must be a GitHub user id, not a login",
    ]);
  });

  it("loads once the placeholder holds a user id", () => {
    const named = readExample().replace(OPERATOR_PLACEHOLDER, "583231");
    expect(loadText(named)).toMatchObject({ ok: true });
  });

  it("loads with every self-contained block uncommented as written", () => {
    const named = readExample().replace(OPERATOR_PLACEHOLDER, "583231");
    const uncommented = uncommentBlocks(named);

    expect(uncommented).toContain("\ngenerator:\n");
    expect(loadText(uncommented)).toMatchObject({ ok: true });
  });
});
