import { describe, expect, it } from "vitest";
import { readYamlLockfile } from "../../../../src/generation/shortened/lockfiles/yaml";
import { LOCKFILE_MAX_BYTES } from "../../../../src/generation/shortened/consts";
import { summarizeTexts } from "../helpers";

const SHAPE = {
  maxDocuments: 2,
  isTopKey: (key: string) => ["lockfileVersion", "packages"].includes(key),
};

const HEADER = "lockfileVersion: '9.0'\npackages:\n";
const TOO_MANY_LINES = 500_001;
const LONG_LINE_CHARS = 9000;
const MANY_ITEMS = 65;
const MARKER_FLOOD = 5;
/** Hostile text that used to exhaust the parser's heap at this size. */
const FLOW_ITEM = "a,";
const PARSE_BUDGET_MS = 2000;

function read(body: string) {
  return readYamlLockfile(`${HEADER}${body}`, SHAPE);
}

describe("yaml lockfile shape", () => {
  it("reads every document up to the writer's count", () => {
    const text = `---\n${HEADER}  a@1.0.0: {}\n---\n${HEADER}  b@1.0.0: {}\n`;

    expect(readYamlLockfile(text, SHAPE)).toEqual({
      ok: true,
      value: [
        { lockfileVersion: "9.0", packages: { "a@1.0.0": {} } },
        { lockfileVersion: "9.0", packages: { "b@1.0.0": {} } },
      ],
    });
  });

  it("reads more documents than the writer emits as unparseable", () => {
    const text = `${HEADER}---\n${HEADER}---\n${HEADER}`;

    expect(readYamlLockfile(text, SHAPE)).toEqual({
      ok: false,
      error: "unparseable",
    });
  });

  it.each([
    ["a top-level key the writer never emits", "x: [a]\n"],
    ["a nested flow collection", "  a@1.0.0: {resolution: {tarball: x}}\n"],
    ["a flow collection spanning lines", "  a@1.0.0: {integrity: x,\n  y}\n"],
    ["a flow collection after a sequence entry", "  - [a, [b]]\n"],
    ["a complex key", "  ? a\n"],
    [
      "a flow collection with too many items",
      `  a@1.0.0: [${"a, ".repeat(MANY_ITEMS)}a]\n`,
    ],
    ["a line too long", `  a@1.0.0: ${"a".repeat(LONG_LINE_CHARS)}\n`],
    ["too many lines", "  a@1.0.0: {}\n".repeat(TOO_MANY_LINES)],
    ["more document markers than documents", "---\n".repeat(MARKER_FLOOD)],
  ])("reads %s as unparseable", (_label, body) => {
    expect(read(body)).toEqual({ ok: false, error: "unparseable" });
  });

  it.each([
    ["an anchor", "  a@1.0.0: &x {integrity: y}\n"],
    ["an alias", "  a@1.0.0: *x\n"],
    ["a tag", "  a@1.0.0: !!map {integrity: y}\n"],
  ])("reads %s before parsing as ambiguous", (_label, body) => {
    expect(read(body)).toEqual({ ok: false, error: "ambiguous" });
  });

  it("keeps quoted flow text and comments out of the flow count", () => {
    const body = `  'a@1.0.0': {integrity: '[,{', tarball: "]}"} # [[\n`;

    expect(read(body)).toEqual({
      ok: true,
      value: [
        {
          lockfileVersion: "9.0",
          packages: { "a@1.0.0": { integrity: "[,{", tarball: "]}" } },
        },
      ],
    });
  });

  it("reads a flow sequence just under the byte cap as unread quickly", () => {
    const items = Math.floor(LOCKFILE_MAX_BYTES / FLOW_ITEM.length) - 64;
    const hostile = `${HEADER}packages: [${FLOW_ITEM.repeat(items)}a]\n`;
    const started = performance.now();

    const summary = summarizeTexts("pnpm-lock.yaml", hostile, hostile);

    expect(summary).toEqual({ format: "pnpm", unread: "unparseable" });
    expect(performance.now() - started).toBeLessThan(PARSE_BUDGET_MS);
  });
});
