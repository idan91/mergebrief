import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildReleaseBody } from "../src/logic/release-body";
import { readReleaseNotes } from "../src/logic/notes";
import type { ReleaseNotes } from "../src/types";
import { makeNotesDir, makeNotesFile } from "./helpers";

const REPO_ROOT = join(import.meta.dirname, "..", "..", "..");
const OPERATIONS_DOC = join(REPO_ROOT, "docs/self-host/operations.md");
const UPGRADE_HEADING = "### The upgrade step";
const BODY = "## Highlights\n\nNotes.\n";

function readNotes(name: string, text: string): ReleaseNotes {
  const read = readReleaseNotes(makeNotesDir({ [name]: text }));
  const notes = read.ok ? read.value[0] : undefined;
  if (notes === undefined) {
    throw new Error("fixture did not parse");
  }
  return notes;
}

/** The fenced sh block under the upgrade-step heading in operations.md. */
function readDocumentedChain(): string {
  const lines = readFileSync(OPERATIONS_DOC, "utf8").split("\n");
  const heading = lines.indexOf(UPGRADE_HEADING);
  expect(heading).toBeGreaterThan(-1);
  const open = lines.indexOf("```sh", heading);
  expect(open).toBeGreaterThan(heading);
  const close = lines.indexOf("```", open + 1);
  expect(close).toBeGreaterThan(open);
  return lines.slice(open + 1, close).join("\n");
}

describe("the Release body", () => {
  it("opens with the documented upgrade chain, the tag filled in", () => {
    const body = buildReleaseBody(
      readNotes("0.2.0.md", makeNotesFile({}, BODY)),
    );

    const documented = readDocumentedChain().replaceAll("v0.1.0", "v0.2.0");
    expect(documented).toContain("releases/download/v0.2.0/docker-compose.yml");
    expect(body.startsWith("## Upgrade to 0.2.0\n")).toBe(true);
    expect(body).toContain(`\`\`\`sh\n${documented}\n\`\`\``);
  });

  it("links the backup and upgrade docs, then carries the notes verbatim", () => {
    const body = buildReleaseBody(
      readNotes("0.2.0.md", makeNotesFile({}, BODY)),
    );

    expect(body).toContain(
      "https://github.com/Idan91/mergebrief/blob/v0.2.0/docs/self-host/operations.md#the-upgrade-step",
    );
    expect(body).toContain("#backup");
    expect(body).toContain("#rolling-back");
    expect(body.endsWith(`\n${BODY}`)).toBe(true);
  });

  it("warns first when the release is breaking", () => {
    const text = makeNotesFile(
      { breaking: "true" },
      `${BODY}\n## Upgrade\n\n1. Add the key.\n`,
    );
    const body = buildReleaseBody(readNotes("1.0.0.md", text));

    expect(body.split("\n")[0]).toBe("## Upgrade to 1.0.0");
    expect(body.split("\n")[2]).toContain("breaking release");
  });

  it("leads with the security fix when the release is one", () => {
    const body = buildReleaseBody(
      readNotes("0.2.1.md", makeNotesFile({ security: "true" }, BODY)),
    );

    expect(body.split("\n")[2]).toContain("security");
  });

  it("marks a candidate as not for production and names the next dist-tag", () => {
    const body = buildReleaseBody(
      readNotes("0.3.0-rc.1.md", makeNotesFile({}, BODY)),
    );

    expect(body.split("\n")[0]).toBe("## Release candidate 0.3.0-rc.1");
    expect(body).toContain("npm i -g mergebrief@next");
    expect(body).not.toContain("```sh");
  });
});
