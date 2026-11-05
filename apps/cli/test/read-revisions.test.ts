// No-flag and `--revision` reads over a scripted api: which brief each serves,
// what the local record remembers, and what a reader is told when it moves.
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ExitCodes } from "../src/exit";
import {
  clearReadRevisions,
  readLastRevision,
  saveLastRevision,
} from "../src/profile/read-revisions";
import {
  expectRefusedBeforeRequest,
  OFFLINE_REPO_ID,
  OFFLINE_REPOS_ROUTE,
  runCliOffline,
  type ScriptedRoute,
} from "./harness/offline";

const PULL_PATH = `/api/repos/${OFFLINE_REPO_ID}/pulls/7`;

function makeSha(digit: number): string {
  return String(digit).repeat(40);
}

function makeRevision(headIndex: number) {
  return {
    baseSha: makeSha(0),
    headSha: makeSha(headIndex),
    headIndex,
    createdAt: "2026-11-04T00:00:00Z",
    generatedAt: "2026-11-04T00:00:00Z",
    comparisons: {},
  };
}

interface MetaOptions {
  readonly latest: number;
  readonly headBriefStored?: boolean;
  readonly generation?: unknown;
}

function makeMetaRoute(options: MetaOptions): ScriptedRoute {
  const { latest, headBriefStored = true, generation = null } = options;
  const revisions = Array.from({ length: latest }, (_, index) =>
    makeRevision(index + 1),
  );
  const head = headBriefStored ? latest : latest + 1;
  return {
    method: "GET",
    path: PULL_PATH,
    body: JSON.stringify({
      baseSha: makeSha(0),
      headSha: makeSha(head),
      briefAvailable: headBriefStored,
      headBriefStored,
      generation,
      comparisons: {},
      revisions,
    }),
  };
}

function makeSessionRoute(
  headIndex: number,
  body: unknown = {},
): ScriptedRoute {
  return {
    method: "GET",
    path: `${PULL_PATH}/session?base=${makeSha(0)}&head=${makeSha(headIndex)}`,
    body: JSON.stringify(body),
  };
}

const REVISION_THREE_LINE = `revision 3 ${"0".repeat(7)}..${"3".repeat(7)}`;
const REVISION_FOUR_LINE = `revision 4 ${"0".repeat(7)}..${"4".repeat(7)}`;

function makeCacheDir(): string {
  return mkdtempSync(join(tmpdir(), "mb-revisions-"));
}

async function runSession(
  cacheDir: string,
  latest: number,
  served: number,
  argv: readonly string[] = [],
) {
  const notices: string[] = [];
  const result = await runCliOffline(["session", "7", ...argv], {
    cacheDir,
    successNotice: (line) => notices.push(line),
    routes: [
      OFFLINE_REPOS_ROUTE,
      makeMetaRoute({ latest }),
      makeSessionRoute(served),
    ],
  });
  return { ...result, notices };
}

describe("a read with no span flags", () => {
  it("serves the latest revision and names it", async () => {
    const result = await runSession(makeCacheDir(), 3, 3);

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.notices).toEqual([REVISION_THREE_LINE]);
    expect(result.requests.at(-1)?.path).toContain(`head=${makeSha(3)}`);
  });

  it("exits 4 naming the generation status with no finished brief", async () => {
    const result = await runCliOffline(["session", "7"], {
      routes: [
        OFFLINE_REPOS_ROUTE,
        makeMetaRoute({
          latest: 0,
          headBriefStored: false,
          generation: { status: "running" },
        }),
      ],
    });

    expect(result.code).toBe(ExitCodes.NOT_FOUND);
    expect(result.out).toBe("");
    expect(result.err).toEqual([
      "no brief generated yet for PR 7 (running); `mergebrief generation 7` shows where its generation stands",
    ]);
  });

  it.each([
    [{ status: "pending" }, "its brief is generating"],
    [{ status: "running" }, "its brief is generating"],
    [
      { status: "awaiting-trigger" },
      "a collaborator must click Generate in MergeBrief",
    ],
    [
      { status: "failed", errorCode: "provider-error" },
      "generation failed: provider-error",
    ],
    [{ status: "capped" }, "generation capped"],
    [null, "no generation has started"],
  ])(
    "serves the finished one when the head has none: %j",
    async (generation, reason) => {
      const notices: string[] = [];
      const result = await runCliOffline(["session", "7"], {
        successNotice: (line) => notices.push(line),
        routes: [
          OFFLINE_REPOS_ROUTE,
          makeMetaRoute({ latest: 3, headBriefStored: false, generation }),
          makeSessionRoute(3),
        ],
      });

      expect(result.code).toBe(ExitCodes.OK);
      expect(notices).toEqual([
        REVISION_THREE_LINE,
        `head ${"4".repeat(7)} has no brief yet, ${reason}; serving revision 3`,
      ]);
    },
  );
});

describe("a hostile server's fields on stderr", () => {
  it("cannot drive the terminal or forge a line", async () => {
    const notices: string[] = [];
    const result = await runCliOffline(["session", "7"], {
      successNotice: (line) => notices.push(line),
      routes: [
        OFFLINE_REPOS_ROUTE,
        makeMetaRoute({
          latest: 3,
          headBriefStored: false,
          generation: {
            status: "failed",
            errorCode: "\u001B[2K\nerror: forged line",
          },
        }),
        makeSessionRoute(3),
      ],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(notices.at(1)).toContain(
      "generation failed: [U+001B][2K[U+000A]error: forged line",
    );
  });
});

describe("a force-push back to an older head", () => {
  function makeHeadBackRoute(): ScriptedRoute {
    const route = makeMetaRoute({ latest: 3 });
    return {
      ...route,
      body: JSON.stringify({
        ...JSON.parse(route.body ?? "{}"),
        headSha: makeSha(2),
        headBriefStored: false,
        briefAvailable: true,
        generation: { status: "succeeded" },
      }),
    };
  }

  it("serves that head's own brief, not the newest row", async () => {
    const notices: string[] = [];
    const result = await runCliOffline(["session", "7"], {
      successNotice: (line) => notices.push(line),
      routes: [OFFLINE_REPOS_ROUTE, makeHeadBackRoute(), makeSessionRoute(2)],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(notices).toEqual([`revision 2 ${"0".repeat(7)}..${"2".repeat(7)}`]);
  });

  it("moves a reviewer on the abandoned revision to that head", async () => {
    const cacheDir = makeCacheDir();
    await runSession(cacheDir, 3, 3);

    const notices: string[] = [];
    await runCliOffline(["session", "7"], {
      cacheDir,
      successNotice: (line) => notices.push(line),
      routes: [OFFLINE_REPOS_ROUTE, makeHeadBackRoute(), makeSessionRoute(2)],
    });
    const after = await runSession(cacheDir, 3, 3);

    expect(notices).toContain(
      "revision 2 is now latest (you were on revision 3).",
    );
    expect(after.notices).toContain(
      "revision 3 is now latest (you were on revision 2).",
    );
  });
});

describe("the moved message", () => {
  it("prints once, from the read that moves the record", async () => {
    const cacheDir = makeCacheDir();
    await runSession(cacheDir, 3, 3);

    const moved = await runSession(cacheDir, 4, 4);
    const after = await runSession(cacheDir, 4, 4);

    expect(moved.notices).toEqual([
      REVISION_FOUR_LINE,
      "revision 4 is now latest (you were on revision 3).",
      "Run `mergebrief session 7` to see what carries over and what needs a re-look.",
    ]);
    expect(after.notices).toEqual([REVISION_FOUR_LINE]);
  });

  it("stays quiet on a machine with no record", async () => {
    const result = await runSession(makeCacheDir(), 4, 4);

    expect(result.notices).toEqual([REVISION_FOUR_LINE]);
  });

  it("keeps the record when the read fails", async () => {
    const cacheDir = makeCacheDir();
    await runSession(cacheDir, 3, 3);

    const failed = await runCliOffline(["session", "7"], {
      cacheDir,
      routes: [
        OFFLINE_REPOS_ROUTE,
        makeMetaRoute({ latest: 4 }),
        { ...makeSessionRoute(4), status: 500 },
      ],
    });
    const retried = await runSession(cacheDir, 4, 4);

    expect(failed.code).toBe(ExitCodes.GENERIC);
    expect(retried.notices).toContain(
      "revision 4 is now latest (you were on revision 3).",
    );
  });

  it("reads a corrupt record as nothing read", async () => {
    const cacheDir = makeCacheDir();
    mkdirSync(join(cacheDir, "default"), { recursive: true });
    writeFileSync(join(cacheDir, "default", "read-revisions.json"), "not json");

    const result = await runSession(cacheDir, 4, 4);

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.notices).toEqual([REVISION_FOUR_LINE]);
  });
});

describe("--revision", () => {
  it("serves the named revision and notes a newer one", async () => {
    const result = await runSession(makeCacheDir(), 4, 3, ["--revision", "3"]);

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.requests.at(-1)?.path).toContain(`head=${makeSha(3)}`);
    expect(result.notices).toEqual([
      "this is revision 3; revision 4 is latest",
    ]);
  });

  it("prints nothing extra for the latest revision", async () => {
    const result = await runSession(makeCacheDir(), 4, 4, ["--revision", "4"]);

    expect(result.notices).toEqual([]);
  });

  it("looking back at an older revision keeps the record", async () => {
    const cacheDir = makeCacheDir();
    await runSession(cacheDir, 4, 4);

    await runSession(cacheDir, 4, 2, ["--revision", "2"]);
    const after = await runSession(cacheDir, 4, 4);

    expect(after.notices).toEqual([REVISION_FOUR_LINE]);
  });

  it("exits 4 for a number not on the PR", async () => {
    const result = await runCliOffline(["session", "7", "--revision", "9"], {
      routes: [OFFLINE_REPOS_ROUTE, makeMetaRoute({ latest: 3 })],
    });

    expect(result.code).toBe(ExitCodes.NOT_FOUND);
    expect(result.err).toEqual([
      "revision 9 is not on PR 7; `mergebrief pr 7 --json` lists its revisions",
    ]);
  });

  it.each([
    [["session", "7", "--revision", "x"]],
    [["session", "7", "--revision", "0"]],
    [["session", "7", "--revision", "1.5"]],
    [["session", "7", "--revision", "1", "--base", "a", "--head", "b"]],
    [["session", "7", "--base", "a"]],
    [["session", "7", "--head", "b"]],
    [["session", "7", "--base", "", "--head", "b"]],
    [["session", "7", "--base", "a", "--head", ""]],
    [["context", "7", "--revision", "x"]],
    [["groups", "7", "--revision", "x"]],
    [["diff", "7", "--revision", "x"]],
    [["diff", "7", "--revision", "1", "--base", "a", "--head", "b"]],
  ])("%j exits 2 without a request", async (argv) => {
    expectRefusedBeforeRequest(await runCliOffline(argv));
  });
});

describe("--base and --head", () => {
  it("skip the read, the notices and the record", async () => {
    const cacheDir = makeCacheDir();
    const notices: string[] = [];
    const result = await runCliOffline(
      ["session", "7", "--base", makeSha(0), "--head", makeSha(9)],
      {
        cacheDir,
        successNotice: (line) => notices.push(line),
        routes: [OFFLINE_REPOS_ROUTE, makeSessionRoute(9)],
      },
    );
    const later = await runSession(cacheDir, 3, 3);

    expect(result.code).toBe(ExitCodes.OK);
    expect(notices).toEqual([]);
    expect(result.requests.map((request) => request.path)).not.toContain(
      PULL_PATH,
    );
    expect(later.notices).toEqual([REVISION_THREE_LINE]);
  });
});

describe("session's own note on a move", () => {
  async function runMoveWith(body: unknown): Promise<string[]> {
    const cacheDir = makeCacheDir();
    await runSession(cacheDir, 3, 3);
    const notices: string[] = [];
    await runCliOffline(["session", "7"], {
      cacheDir,
      successNotice: (line) => notices.push(line),
      routes: [
        OFFLINE_REPOS_ROUTE,
        makeMetaRoute({ latest: 4 }),
        makeSessionRoute(4, body),
      ],
    });
    return notices.slice(2);
  }

  const orphan = { kind: "orphaned-anchor" };
  const reopened = { kind: "reopened-disposition" };

  it("counts the drafts that lost their lines", async () => {
    const notes = await runMoveWith({
      materialized: false,
      carriedFrom: { revisions: 1, items: 1 },
      attention: [orphan, reopened, orphan],
    });

    expect(notes).toEqual([
      "Your work carries over on your next write. 2 drafts lost their lines: re-anchor them in MergeBrief.",
    ]);
  });

  it("uses the singular for one draft", async () => {
    const notes = await runMoveWith({
      materialized: false,
      carriedFrom: { revisions: 1, items: 1 },
      attention: [orphan],
    });

    expect(notes).toEqual([
      "Your work carries over on your next write. 1 draft lost its lines: re-anchor it in MergeBrief.",
    ]);
  });

  it("counts lost drafts once another client carried the work", async () => {
    const notes = await runMoveWith({
      materialized: true,
      carriedFrom: { revisions: 1, items: 2 },
      attention: [orphan, orphan],
    });

    expect(notes).toEqual([
      "Your work carried over. 2 drafts lost their lines: re-anchor them in MergeBrief.",
    ]);
  });

  it("names no work when the previous session carried nothing", async () => {
    const notes = await runMoveWith({
      materialized: false,
      carriedFrom: { revisions: 1, items: 0 },
      attention: [],
    });

    expect(notes).toEqual([]);
  });

  it("says the work already carried once the session holds it", async () => {
    const notes = await runMoveWith({
      materialized: true,
      carriedFrom: { revisions: 1, items: 1 },
      attention: [],
    });

    expect(notes).toEqual(["Your work carried over."]);
  });

  it("names no work when there is none", async () => {
    const notes = await runMoveWith({
      materialized: false,
      carriedFrom: null,
      attention: [],
    });

    expect(notes).toEqual([]);
  });

  it("falls back to pointing at session on a body it cannot read", async () => {
    const notes = await runMoveWith({ attention: "not a list" });

    expect(notes).toEqual([
      "Run `mergebrief session 7` to see what carries over and what needs a re-look.",
    ]);
  });
});

describe("groups, context and diff", () => {
  const span = `base=${makeSha(0)}&head=${makeSha(3)}`;

  it.each([
    [["groups", "7"], `${PULL_PATH}/brief?${span}`],
    [["context", "7"], `${PULL_PATH}/brief-context?${span}`],
    [["diff", "7"], `${PULL_PATH}/diff?${span}`],
  ])("%j serves the latest finished revision", async (argv, path) => {
    const notices: string[] = [];
    const result = await runCliOffline(argv, {
      successNotice: (line) => notices.push(line),
      routes: [
        OFFLINE_REPOS_ROUTE,
        makeMetaRoute({
          latest: 3,
          headBriefStored: false,
          generation: { status: "pending" },
        }),
        { method: "GET", path, body: "{}" },
      ],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(notices.at(0)).toBe(REVISION_THREE_LINE);
    expect(notices.at(1)).toContain("its brief is generating");
  });

  it.each([
    [["groups", "7", "--revision", "2"], "brief"],
    [["context", "7", "--revision", "2"], "brief-context"],
    [["diff", "7", "--revision", "2"], "diff"],
  ])("%j reads the named revision", async (argv, leaf) => {
    const named = `base=${makeSha(0)}&head=${makeSha(2)}`;
    const result = await runCliOffline(argv, {
      routes: [
        OFFLINE_REPOS_ROUTE,
        makeMetaRoute({ latest: 3 }),
        { method: "GET", path: `${PULL_PATH}/${leaf}?${named}`, body: "{}" },
      ],
    });

    expect(result.code).toBe(ExitCodes.OK);
  });

  it("filters a named revision's own group", async () => {
    const named = `base=${makeSha(0)}&head=${makeSha(2)}`;
    const raw =
      "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -0,0 +1 @@\n+kept\n";
    const brief = {
      chunks: [
        {
          id: "c1",
          changeGroupId: "grp-1",
          file: "a.ts",
          addedRanges: [{ start: 1, end: 1 }],
          removedRanges: [],
        },
      ],
    };
    const result = await runCliOffline(
      ["diff", "7", "--group", "grp-1", "--revision", "2"],
      {
        routes: [
          OFFLINE_REPOS_ROUTE,
          makeMetaRoute({ latest: 3 }),
          {
            method: "GET",
            path: `${PULL_PATH}/brief?${named}`,
            body: JSON.stringify(brief),
          },
          { method: "GET", path: `${PULL_PATH}/diff?${named}`, body: raw },
        ],
      },
    );

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toContain("+kept");
  });

  it("refuses a group on a custom span, as before", async () => {
    const result = await runCliOffline([
      "diff",
      "7",
      "--group",
      "g",
      "--base",
      "a",
      "--head",
      "b",
    ]);

    expectRefusedBeforeRequest(result, "--group");
  });
});

describe("a profile moved to another instance", () => {
  it("drops the record along with the repo cache", () => {
    const cache = { cacheDir: makeCacheDir(), profileName: "default" };
    const address = { repoId: "1", prNumber: 7 };

    saveLastRevision(cache, address, 3);
    clearReadRevisions(cache.cacheDir, cache.profileName);

    expect(readLastRevision(cache, address)).toBeUndefined();
  });
});
