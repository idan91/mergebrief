// The repo-policy case's predicates, validated WITHOUT a generation run: the
// case is unbaselined and costs real spend, so its properties must be proved
// to discriminate before anyone pays for a run. Each one is scored against a
// brief that should pass it and a brief that should fail it.
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Brief, Chunk } from "brief-core/types";
import { loadCases } from "../eval/loadCase";
import { scoreRuns } from "../eval/properties";
import { makeBrief } from "./eval-fixtures";

const CASES_DIR = fileURLToPath(new URL("../eval/cases", import.meta.url));
const CASE_ID = "repo-policy-scoped-attribute";
const TYPES_FILE = "src/components/CopyButton/CopyButton.types.ts";
const SCSS_FILE = "src/components/CopyButton/CopyButton.module.scss";

function chunk(file: string, riskSurface: readonly string[]): Chunk {
  return {
    id: `c-${file}`,
    changeGroupId: "g1",
    file,
    concern: "implementation",
    role: "core",
    addedRanges: [],
    removedRanges: [],
    loc: { added: 1, deleted: 0 },
    riskSurface: riskSurface as Chunk["riskSurface"],
  };
}

function briefWith(chunks: readonly Chunk[]): Brief {
  return makeBrief({ chunks: [...chunks] });
}

async function properties() {
  const loaded = await loadCases(CASES_DIR, CASE_ID);
  if (!loaded.ok) {
    throw new Error(loaded.error);
  }
  const found = loaded.value[0];
  if (found === undefined) {
    throw new Error(`${CASE_ID} did not load`);
  }
  return found;
}

function passesOf(brief: Brief, ids: readonly string[]) {
  return async () => {
    const { properties: list } = await properties();
    const scored = scoreRuns(list, [brief]);
    return ids.map((id) => scored.scores.get(id)?.passes ?? -1);
  };
}

describe("the repo-policy case", () => {
  it("passes a brief that injects the attribute inside its globs", async () => {
    const brief = briefWith([
      chunk(TYPES_FILE, ["prop-surface"]),
      chunk(SCSS_FILE, ["style-token-drift"]),
    ]);
    const read = passesOf(brief, [
      "scoped-file-is-chunked",
      "repo-attribute-reaches-the-brief",
      "second-repo-attribute-also-reaches",
      "repo-attribute-stays-inside-its-globs",
    ]);
    expect(await read()).toEqual([1, 1, 1, 1]);
  });

  it("fails the second reach property when the scss attribute is absent", async () => {
    const brief = briefWith([
      chunk(TYPES_FILE, ["prop-surface"]),
      chunk(SCSS_FILE, []),
    ]);
    const read = passesOf(brief, [
      "repo-attribute-reaches-the-brief",
      "second-repo-attribute-also-reaches",
    ]);
    expect(await read()).toEqual([1, 0]);
  });

  it("fails the reach property when no repo attribute arrives", async () => {
    const brief = briefWith([chunk(TYPES_FILE, ["cross-service"])]);
    const read = passesOf(brief, ["repo-attribute-reaches-the-brief"]);
    expect(await read()).toEqual([0]);
  });

  it("fails the scope property when an attribute lands outside its globs", async () => {
    const brief = briefWith([
      chunk(TYPES_FILE, ["prop-surface"]),
      chunk("src/components/CopyButton/CopyButton.tsx", ["prop-surface"]),
    ]);
    const read = passesOf(brief, ["repo-attribute-stays-inside-its-globs"]);
    expect(await read()).toEqual([0]);
  });

  it("fails when a risk token names an attribute nobody declared", async () => {
    const brief = briefWith([chunk(TYPES_FILE, ["prop-surface", "invented"])]);
    const read = passesOf(brief, ["no-invented-attribute-names"]);
    expect(await read()).toEqual([0]);
  });

  it("accepts a built-in token beside the declared repo attribute", async () => {
    const brief = briefWith([
      chunk(TYPES_FILE, ["prop-surface", "cross-service"]),
    ]);
    const read = passesOf(brief, ["no-invented-attribute-names"]);
    expect(await read()).toEqual([1]);
  });

  it("fails everything when the scoped file is never chunked", async () => {
    const brief = briefWith([chunk("src/index.ts", [])]);
    const read = passesOf(brief, [
      "scoped-file-is-chunked",
      "repo-attribute-reaches-the-brief",
    ]);
    expect(await read()).toEqual([0, 0]);
  });
});
