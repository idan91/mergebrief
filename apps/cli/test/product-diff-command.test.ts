// `product-diff` over a scripted api: the section it lifts out of the brief
// body, what it prints for a brief with none, and the terminal block. The
// brief read itself is `groups`'s, pinned against the real api there.
import { describe, expect, it } from "vitest";
import { ExitCodes } from "../src/exit";
import { OFFLINE_REPOS_ROUTE, runCliOffline } from "./harness/offline";
import { makeMetaRoute, makeSha, PULL_PATH } from "./harness/revisions";

const LATEST = 3;
const BRIEF_PATH = `${PULL_PATH}/brief?base=${makeSha(0)}&head=${makeSha(LATEST)}`;

const SIGN_IN_CHANGE = {
  when: "a signed-out visitor opens a brief link",
  before: "the page shows an error",
  after: "the page asks them to sign in",
  affects: "user-flow",
  beforeSource: "diff",
  groupIds: ["grp-1", "grp-2"],
};
const NEW_ROUTE_CHANGE = {
  when: "a client calls `GET /api/version`",
  after: "the server answers with its version",
  affects: "api-contract",
  beforeSource: "did-not-exist",
  groupIds: ["grp-3"],
};
const PRODUCT_DIFF = {
  availability: "available",
  changes: [SIGN_IN_CHANGE, NEW_ROUTE_CHANGE],
  hasMore: true,
};

function runProductDiff(brief: unknown, argv: readonly string[] = []) {
  const body = typeof brief === "string" ? brief : JSON.stringify(brief);
  return runCliOffline(["product-diff", "7", ...argv], {
    routes: [
      OFFLINE_REPOS_ROUTE,
      makeMetaRoute({ latest: LATEST }),
      { method: "GET", path: BRIEF_PATH, body },
    ],
  });
}

describe("product-diff --json", () => {
  it("prints the brief's Product diff alone, under its own key", async () => {
    const brief = {
      summary: "a brief",
      changeGroups: [{ id: "grp-1", title: "Sign-in" }],
      productDiff: PRODUCT_DIFF,
    };

    const result = await runProductDiff(brief, ["--json"]);

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(
      `${JSON.stringify({ productDiff: PRODUCT_DIFF })}\n`,
    );
  });

  it("prints an empty object for a brief with no Product diff", async () => {
    const result = await runProductDiff({ changeGroups: [] }, ["--json"]);

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe("{}\n");
  });

  it("passes on a section whose shape it does not know", async () => {
    const newer = { availability: "partial", rows: [1], note: "newer" };

    const result = await runProductDiff({ productDiff: newer }, ["--json"]);

    expect(result.out).toBe(`${JSON.stringify({ productDiff: newer })}\n`);
  });

  it("exits 1 with one line when the brief body is not an object", async () => {
    const result = await runProductDiff("not json", ["--json"]);

    expect(result.code).toBe(ExitCodes.GENERIC);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain("brief response did not match");
  });
});

describe("product-diff on a terminal", () => {
  it("prints a head line, then four lines per change", async () => {
    const result = await runProductDiff({ productDiff: PRODUCT_DIFF });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(
      [
        "PR 7 · Product diff · available · 2 changes · more not listed",
        "user-flow\ta signed-out visitor opens a brief link",
        "  before (diff)\tthe page shows an error",
        "  after\tthe page asks them to sign in",
        "  groups\tgrp-1, grp-2",
        "api-contract\ta client calls `GET /api/version`",
        "  before (did-not-exist)\t-",
        "  after\tthe server answers with its version",
        "  groups\tgrp-3",
        "",
      ].join("\n"),
    );
  });

  it("says so when the brief has no Product diff", async () => {
    const result = await runProductDiff({ changeGroups: [] });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe("PR 7 · this brief has no Product diff\n");
  });

  it("never counts zero changes for a section no call wrote", async () => {
    const unavailable = {
      availability: "unavailable",
      changes: [],
      hasMore: false,
    };

    const result = await runProductDiff({ productDiff: unavailable });

    expect(result.out).toBe(
      "PR 7 · Product diff · unavailable · nothing listed\n",
    );
  });

  it("says none found when a read section lists no change", async () => {
    const noneFound = {
      availability: "available",
      changes: [],
      hasMore: false,
    };

    const result = await runProductDiff({ productDiff: noneFound });

    expect(result.out).toBe("PR 7 · Product diff · available · none found\n");
  });

  it("escapes every server string it prints", async () => {
    const hostile = "x\u202Ey\u001B[2Jz";
    const escaped = "x[U+202E]y[U+001B][2Jz";
    const productDiff = {
      availability: hostile,
      changes: [
        {
          when: hostile,
          before: hostile,
          after: hostile,
          affects: hostile,
          beforeSource: hostile,
          groupIds: [hostile],
        },
      ],
      hasMore: false,
    };

    const result = await runProductDiff({ productDiff });

    expect(result.out).toBe(
      [
        `PR 7 · Product diff · ${escaped} · 1 change`,
        `${escaped}\t${escaped}`,
        `  before (${escaped})\t${escaped}`,
        `  after\t${escaped}`,
        `  groups\t${escaped}`,
        "",
      ].join("\n"),
    );
  });

  it("prints a section it cannot read as escaped JSON", async () => {
    const newer = { availability: "partial", note: "a \u202E b" };

    const result = await runProductDiff({ productDiff: newer });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(
      '{"availability":"partial","note":"a [U+202E] b"}\n',
    );
  });
});
