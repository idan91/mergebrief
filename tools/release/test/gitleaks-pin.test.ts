import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GITLEAKS_IMAGE } from "../src/consts";

const WORKFLOWS_DIR = join(
  import.meta.dirname,
  "..",
  "..",
  "..",
  ".github",
  "workflows",
);
const GITLEAKS_IMAGE_REFERENCE = /ghcr\.io\/gitleaks\/gitleaks[^\s"'`]*/g;

function readWorkflowImageReferences(): string[] {
  const workflows = readdirSync(WORKFLOWS_DIR).filter((name) =>
    name.endsWith(".yml"),
  );
  const references = workflows.flatMap((name) => {
    const source = readFileSync(join(WORKFLOWS_DIR, name), "utf8");
    return source.match(GITLEAKS_IMAGE_REFERENCE) ?? [];
  });
  return references;
}

describe("the gitleaks pin", () => {
  it("is the same image in every workflow as in the export gate", () => {
    const mismatched = readWorkflowImageReferences().filter(
      (reference) => reference !== GITLEAKS_IMAGE,
    );

    expect(mismatched).toEqual([]);
  });
});
