// No-flag writes over a scripted api, one test per row of the state matrix:
// a private write stays on the reviewer's revision; `submit` refuses unless
// they are on the newest code.
import { describe, expect, it } from "vitest";
import { ExitCodes } from "../src/exit";
import { readLastSpan, saveLastSpan } from "../src/profile/read-revisions";
import {
  expectRefusedBeforeRequest,
  OFFLINE_REPO_ID,
  OFFLINE_REPOS_ROUTE,
  runCliOffline,
  type ScriptedRoute,
} from "./harness/offline";
import {
  makeCacheDir,
  makeHeadBackMetaRoute,
  makeMetaRoute,
  makeRetargetedMetaRoute,
  makeSessionRoute,
  makeSha,
  PULL_PATH,
} from "./harness/revisions";

const OUTCOME_ARGV = ["outcome", "7", "comment"];
const SUBMIT_ARGV = [
  "submit",
  "7",
  "--outcome",
  "comment",
  "--body",
  "looks ok",
];

function makeSpanQuery(headIndex: number): string {
  return `base=${makeSha(0)}&head=${makeSha(headIndex)}`;
}

function makeOutcomeRoute(headIndex: number): ScriptedRoute {
  return {
    method: "PUT",
    path: `${PULL_PATH}/session/outcome?${makeSpanQuery(headIndex)}`,
    body: '{"outcome":"comment"}',
  };
}

function makeSubmitRoute(headIndex: number): ScriptedRoute {
  return {
    method: "POST",
    path: `${PULL_PATH}/review?${makeSpanQuery(headIndex)}`,
    body: '{"reviewId":"1","commentsDegraded":false}',
  };
}

function makeRecordedCache(headIndex: number): string {
  const cacheDir = makeCacheDir();
  saveLastSpan(
    { cacheDir, profileName: "default" },
    { repoId: String(OFFLINE_REPO_ID), prNumber: 7 },
    { base: makeSha(0), head: makeSha(headIndex) },
  );
  return cacheDir;
}

interface WriteRun {
  readonly argv: readonly string[];
  readonly cacheDir?: string;
  readonly routes: readonly ScriptedRoute[];
}

async function runWrite({ argv, cacheDir, routes }: WriteRun) {
  const notices: string[] = [];
  const result = await runCliOffline(argv, {
    cacheDir: cacheDir ?? makeCacheDir(),
    successNotice: (line) => notices.push(line),
    routes: [OFFLINE_REPOS_ROUTE, ...routes],
  });
  return { ...result, notices };
}

const MATERIALIZED = { materialized: true, carriedFrom: null };
const NO_WORK = { materialized: false, carriedFrom: null };
const WORK_ON_THREE = {
  materialized: false,
  carriedFrom: { revisions: 1, items: 2 },
};
const NOTHING_CARRIED = {
  materialized: false,
  carriedFrom: { revisions: 3, items: 0 },
};

describe("a private write with a record", () => {
  it("writes to latest when the record is latest", async () => {
    const result = await runWrite({
      argv: OUTCOME_ARGV,
      cacheDir: makeRecordedCache(3),
      routes: [makeMetaRoute({ latest: 3 }), makeOutcomeRoute(3)],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.notices).toEqual([]);
  });

  it("names the head when it has no brief yet", async () => {
    const result = await runWrite({
      argv: OUTCOME_ARGV,
      cacheDir: makeRecordedCache(3),
      routes: [
        makeMetaRoute({
          latest: 3,
          headBriefStored: false,
          generation: { status: "running" },
        }),
        makeOutcomeRoute(3),
      ],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.notices).toEqual([
      `head ${"4".repeat(7)} has no brief yet, its brief is generating; writing on revision 3`,
    ]);
  });

  it("stays on the reviewer's revision when a newer one exists", async () => {
    const result = await runWrite({
      argv: OUTCOME_ARGV,
      cacheDir: makeRecordedCache(3),
      routes: [makeMetaRoute({ latest: 4 }), makeOutcomeRoute(3)],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.notices).toEqual([
      "writing on revision 3; revision 4 is latest. Run `mergebrief session 7` to move.",
    ]);
  });

  it("stays put and says so when the head was pushed back", async () => {
    const result = await runWrite({
      argv: OUTCOME_ARGV,
      cacheDir: makeRecordedCache(3),
      routes: [makeHeadBackMetaRoute(), makeOutcomeRoute(3)],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.notices).toEqual([
      "writing on revision 3; the head went back to revision 2",
    ]);
  });

  it("stays on the old base through a retarget", async () => {
    const result = await runWrite({
      argv: OUTCOME_ARGV,
      cacheDir: makeRecordedCache(3),
      routes: [makeRetargetedMetaRoute(), makeOutcomeRoute(3)],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.notices).toEqual([
      "writing on revision 3; revision 4 is latest. Run `mergebrief session 7` to move.",
    ]);
  });

  it("names a push only GitHub has seen", async () => {
    const result = await runWrite({
      argv: OUTCOME_ARGV,
      cacheDir: makeRecordedCache(3),
      routes: [makeMetaRoute({ latest: 3, behind: true }), makeOutcomeRoute(3)],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.notices).toEqual([
      "GitHub reports commits no brief covers yet; writing on revision 3",
    ]);
  });

  it("does not ask the server where the work is", async () => {
    const result = await runWrite({
      argv: OUTCOME_ARGV,
      cacheDir: makeRecordedCache(3),
      routes: [makeMetaRoute({ latest: 3 }), makeOutcomeRoute(3)],
    });

    const paths = result.requests.map((request) => request.path);
    expect(paths.some((path) => path.includes("/session?"))).toBe(false);
  });
});

describe("a private write with no record", () => {
  it("writes to latest when the work is on latest", async () => {
    const result = await runWrite({
      argv: OUTCOME_ARGV,
      routes: [
        makeMetaRoute({ latest: 4 }),
        makeSessionRoute(4, MATERIALIZED),
        makeOutcomeRoute(4),
      ],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.notices).toEqual([]);
  });

  it("continues on the revision holding the work", async () => {
    const result = await runWrite({
      argv: OUTCOME_ARGV,
      routes: [
        makeMetaRoute({ latest: 4 }),
        makeSessionRoute(4, WORK_ON_THREE),
        makeOutcomeRoute(3),
      ],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.notices).toEqual([
      "writing on revision 3; revision 4 is latest. Run `mergebrief session 7` to move.",
    ]);
  });

  it("writes to latest and names it with no work anywhere", async () => {
    const result = await runWrite({
      argv: OUTCOME_ARGV,
      routes: [
        makeMetaRoute({ latest: 4 }),
        makeSessionRoute(4, NO_WORK),
        makeOutcomeRoute(4),
      ],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.notices).toEqual([
      "writing on revision 4, the latest; nothing shows you read PR 7 here",
    ]);
  });

  it("treats a previous session that carried nothing as no work", async () => {
    const result = await runWrite({
      argv: OUTCOME_ARGV,
      routes: [
        makeMetaRoute({ latest: 4 }),
        makeSessionRoute(4, NOTHING_CARRIED),
        makeOutcomeRoute(4),
      ],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.notices).toEqual([
      "writing on revision 4, the latest; nothing shows you read PR 7 here",
    ]);
  });

  it("asks the server only once per machine", async () => {
    const cacheDir = makeCacheDir();
    const routes = [
      makeMetaRoute({ latest: 4 }),
      makeSessionRoute(4, NO_WORK),
      makeOutcomeRoute(4),
    ];
    await runWrite({ argv: OUTCOME_ARGV, cacheDir, routes });

    const second = await runWrite({ argv: OUTCOME_ARGV, cacheDir, routes });

    const paths = second.requests.map((request) => request.path);
    expect(paths.some((path) => path.includes("/session?"))).toBe(false);
    expect(second.notices).toEqual([]);
  });

  it("treats a span no longer on the PR as no record", async () => {
    const result = await runWrite({
      argv: OUTCOME_ARGV,
      cacheDir: makeRecordedCache(9),
      routes: [
        makeMetaRoute({ latest: 4 }),
        makeSessionRoute(4, MATERIALIZED),
        makeOutcomeRoute(4),
      ],
    });

    expect(result.code).toBe(ExitCodes.OK);
  });

  it("leaves no record when the write fails", async () => {
    const cacheDir = makeCacheDir();
    const failed = await runWrite({
      argv: OUTCOME_ARGV,
      cacheDir,
      routes: [
        makeMetaRoute({ latest: 4 }),
        makeSessionRoute(4, NO_WORK),
        { ...makeOutcomeRoute(4), status: 500, body: "{}" },
      ],
    });
    const retried = await runWrite({
      argv: OUTCOME_ARGV,
      cacheDir,
      routes: [
        makeMetaRoute({ latest: 4 }),
        makeSessionRoute(4, NO_WORK),
        makeOutcomeRoute(4),
      ],
    });

    expect(failed.code).toBe(ExitCodes.GENERIC);
    expect(failed.notices).toEqual([]);
    expect(retried.notices).toHaveLength(1);
  });
});

describe("any no-flag write", () => {
  it("exits 4 naming the status with no finished brief", async () => {
    const result = await runWrite({
      argv: OUTCOME_ARGV,
      routes: [
        makeMetaRoute({
          latest: 0,
          headBriefStored: false,
          generation: { status: "pending" },
        }),
      ],
    });

    expect(result.code).toBe(ExitCodes.NOT_FOUND);
    expect(result.err[0]).toContain(
      "no brief generated yet for PR 7 (pending)",
    );
  });

  it("keeps its exit when the session read fails, writing nothing", async () => {
    const result = await runWrite({
      argv: OUTCOME_ARGV,
      routes: [
        makeMetaRoute({ latest: 4 }),
        { ...makeSessionRoute(4, "{}"), status: 500 },
      ],
    });

    expect(result.code).toBe(ExitCodes.GENERIC);
    expect(result.requests.map((request) => request.method)).not.toContain(
      "PUT",
    );
  });
});

describe("submit with no span flags", () => {
  function expectRefused(
    result: Awaited<ReturnType<typeof runWrite>>,
    fragment: string,
  ): void {
    expect(result.code).toBe(ExitCodes.SERVER_REJECTED);
    expect(result.out).toBe("");
    expect(result.err).toHaveLength(1);
    expect(result.err[0]).toContain(fragment);
    expect(result.requests.map((request) => request.method)).not.toContain(
      "POST",
    );
  }

  it("posts on latest when the record is latest", async () => {
    const result = await runWrite({
      argv: SUBMIT_ARGV,
      cacheDir: makeRecordedCache(3),
      routes: [makeMetaRoute({ latest: 3 }), makeSubmitRoute(3)],
    });

    expect(result.code).toBe(ExitCodes.OK);
  });

  it("refuses when a newer revision exists", async () => {
    const result = await runWrite({
      argv: SUBMIT_ARGV,
      cacheDir: makeRecordedCache(3),
      routes: [makeMetaRoute({ latest: 4 })],
    });

    expectRefused(result, "pass --revision 3");
  });

  it("refuses when the head moved and its brief is not done", async () => {
    const result = await runWrite({
      argv: SUBMIT_ARGV,
      cacheDir: makeRecordedCache(3),
      routes: [
        makeMetaRoute({
          latest: 3,
          headBriefStored: false,
          generation: { status: "running" },
        }),
      ],
    });

    expectRefused(result, "has no brief yet");
  });

  it("refuses a push only GitHub has seen", async () => {
    const result = await runWrite({
      argv: SUBMIT_ARGV,
      cacheDir: makeRecordedCache(3),
      routes: [makeMetaRoute({ latest: 3, behind: true })],
    });

    expectRefused(result, "GitHub reports commits no brief covers yet");
  });

  it("refuses when the head was pushed back past the reviewer", async () => {
    const result = await runWrite({
      argv: SUBMIT_ARGV,
      cacheDir: makeRecordedCache(3),
      routes: [makeHeadBackMetaRoute()],
    });

    expectRefused(result, "the head went back to revision 2");
  });

  it("refuses when a previous session carried nothing", async () => {
    const result = await runWrite({
      argv: SUBMIT_ARGV,
      routes: [
        makeMetaRoute({ latest: 4 }),
        makeSessionRoute(4, NOTHING_CARRIED),
      ],
    });

    expectRefused(result, "no sign you read PR 7");
  });

  it("refuses on a pushed-back head even when on its revision", async () => {
    const result = await runWrite({
      argv: SUBMIT_ARGV,
      cacheDir: makeRecordedCache(2),
      routes: [makeHeadBackMetaRoute()],
    });

    expectRefused(result, "pass --revision 2");
  });

  it("refuses a retarget's new revision on the same head", async () => {
    const result = await runWrite({
      argv: SUBMIT_ARGV,
      cacheDir: makeRecordedCache(3),
      routes: [makeRetargetedMetaRoute()],
    });

    expectRefused(result, "pass --revision 3");
  });

  it("refuses a span from before the PR was purged", async () => {
    const result = await runWrite({
      argv: SUBMIT_ARGV,
      cacheDir: makeRecordedCache(9),
      routes: [makeMetaRoute({ latest: 4 }), makeSessionRoute(4, NO_WORK)],
    });

    expectRefused(result, "no sign you read PR 7");
  });

  it("posts on latest with no record and work on latest", async () => {
    const result = await runWrite({
      argv: SUBMIT_ARGV,
      routes: [
        makeMetaRoute({ latest: 4 }),
        makeSessionRoute(4, MATERIALIZED),
        makeSubmitRoute(4),
      ],
    });

    expect(result.code).toBe(ExitCodes.OK);
  });

  it("refuses with no record when the head moved past the work", async () => {
    const result = await runWrite({
      argv: SUBMIT_ARGV,
      routes: [
        makeMetaRoute({
          latest: 4,
          headBriefStored: false,
          generation: { status: "awaiting-trigger" },
        }),
        makeSessionRoute(4, MATERIALIZED),
      ],
    });

    expectRefused(result, "has no brief yet");
  });

  it("refuses with no record and work on an older revision", async () => {
    const result = await runWrite({
      argv: SUBMIT_ARGV,
      routes: [
        makeMetaRoute({ latest: 4 }),
        makeSessionRoute(4, WORK_ON_THREE),
      ],
    });

    expectRefused(result, "pass --revision 3");
  });

  it("refuses with no sign of any reading", async () => {
    const result = await runWrite({
      argv: SUBMIT_ARGV,
      routes: [makeMetaRoute({ latest: 4 }), makeSessionRoute(4, NO_WORK)],
    });

    expectRefused(result, "no sign you read PR 7");
  });

  it("posts after a read moves the reviewer forward", async () => {
    const cacheDir = makeRecordedCache(3);
    await runCliOffline(["session", "7"], {
      cacheDir,
      routes: [
        OFFLINE_REPOS_ROUTE,
        makeMetaRoute({ latest: 4 }),
        makeSessionRoute(4),
      ],
    });

    const result = await runWrite({
      argv: SUBMIT_ARGV,
      cacheDir,
      routes: [makeMetaRoute({ latest: 4 }), makeSubmitRoute(4)],
    });

    expect(result.code).toBe(ExitCodes.OK);
  });
});

describe("the commands with their own write path", () => {
  it("chunk-read --group stays on the reviewer's revision", async () => {
    const brief = {
      chunks: [
        {
          id: "c1",
          changeGroupId: "g1",
          file: "a.ts",
          addedRanges: [],
          removedRanges: [],
        },
      ],
    };
    const result = await runWrite({
      argv: ["chunk-read", "7", "--group", "g1"],
      cacheDir: makeRecordedCache(3),
      routes: [
        makeMetaRoute({ latest: 4 }),
        {
          method: "GET",
          path: `${PULL_PATH}/brief?${makeSpanQuery(3)}`,
          body: JSON.stringify(brief),
        },
        {
          method: "POST",
          path: `${PULL_PATH}/session/chunks/c1/read?${makeSpanQuery(3)}`,
        },
      ],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.notices).toEqual([
      "writing on revision 3; revision 4 is latest. Run `mergebrief session 7` to move.",
    ]);
  });

  it("draft attach --draft stays on the reviewer's revision", async () => {
    const image = "/shots/shot.png";
    const receipt = JSON.stringify({ url: "https://example.test/a.png" });
    const session = { draftComments: [{ id: "5", body: "tighten this" }] };
    const result = await runCliOffline(
      ["draft", "attach", "7", image, "--draft", "5", "--json"],
      {
        cacheDir: makeRecordedCache(3),
        files: { [image]: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]) },
        routes: [
          OFFLINE_REPOS_ROUTE,
          makeMetaRoute({ latest: 4 }),
          makeSessionRoute(3, session),
          {
            method: "POST",
            path: `${PULL_PATH}/attachments`,
            body: receipt,
          },
          {
            method: "PATCH",
            path: `${PULL_PATH}/session/comments/5?${makeSpanQuery(3)}`,
          },
        ],
      },
    );

    expect(result.err).toEqual([
      "writing on revision 3; revision 4 is latest. Run `mergebrief session 7` to move.",
    ]);
    expect(result.code).toBe(ExitCodes.OK);
    expect(result.out).toBe(receipt);
  });

  it("draft attach with no --draft reads no pull request", async () => {
    const image = "/shots/shot.png";
    const receipt = JSON.stringify({ url: "https://example.test/a.png" });
    const result = await runCliOffline(
      ["draft", "attach", "7", image, "--json"],
      {
        files: { [image]: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]) },
        routes: [
          OFFLINE_REPOS_ROUTE,
          { method: "POST", path: `${PULL_PATH}/attachments`, body: receipt },
        ],
      },
    );

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.requests.map((request) => request.path)).not.toContain(
      PULL_PATH,
    );
  });
});

describe("flags that name the brief", () => {
  it("--revision posts on an older revision, with a note", async () => {
    const result = await runWrite({
      argv: [...SUBMIT_ARGV, "--revision", "3"],
      routes: [makeMetaRoute({ latest: 4 }), makeSubmitRoute(3)],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.notices).toEqual([
      "this is revision 3; revision 4 is latest",
    ]);
  });

  it("--revision posts on a pushed-back head on purpose", async () => {
    const result = await runWrite({
      argv: [...SUBMIT_ARGV, "--revision", "2"],
      cacheDir: makeRecordedCache(2),
      routes: [makeHeadBackMetaRoute(), makeSubmitRoute(2)],
    });

    expect(result.code).toBe(ExitCodes.OK);
  });

  it("--revision skips the guard and leaves the record", async () => {
    const cacheDir = makeRecordedCache(3);
    const result = await runWrite({
      argv: [...OUTCOME_ARGV, "--revision", "2"],
      cacheDir,
      routes: [makeMetaRoute({ latest: 4 }), makeOutcomeRoute(2)],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(
      readLastSpan(
        { cacheDir, profileName: "default" },
        { repoId: String(OFFLINE_REPO_ID), prNumber: 7 },
      ),
    ).toEqual({ base: makeSha(0), head: makeSha(3) });
  });

  it("--revision on a write records nothing with no record", async () => {
    const cacheDir = makeCacheDir();
    await runWrite({
      argv: [...OUTCOME_ARGV, "--revision", "2"],
      cacheDir,
      routes: [makeMetaRoute({ latest: 4 }), makeOutcomeRoute(2)],
    });

    expect(
      readLastSpan(
        { cacheDir, profileName: "default" },
        { repoId: String(OFFLINE_REPO_ID), prNumber: 7 },
      ),
    ).toBeUndefined();
  });

  it("exits 4 for a revision not on the PR", async () => {
    const result = await runWrite({
      argv: [...OUTCOME_ARGV, "--revision", "9"],
      routes: [makeMetaRoute({ latest: 4 })],
    });

    expect(result.code).toBe(ExitCodes.NOT_FOUND);
  });

  it("--base and --head add no read and no notice", async () => {
    const result = await runWrite({
      argv: [...SUBMIT_ARGV, "--base", makeSha(0), "--head", makeSha(2)],
      routes: [makeSubmitRoute(2)],
    });

    expect(result.code).toBe(ExitCodes.OK);
    expect(result.notices).toEqual([]);
    expect(result.requests.map((request) => request.path)).not.toContain(
      PULL_PATH,
    );
  });

  it.each([
    [[...OUTCOME_ARGV, "--base", "a"]],
    [[...OUTCOME_ARGV, "--revision", "x"]],
    [[...OUTCOME_ARGV, "--revision", "1", "--base", "a", "--head", "b"]],
    [[...SUBMIT_ARGV, "--head", "b"]],
    [[...SUBMIT_ARGV, "--revision", "0"]],
    [["draft", "delete", "7", "d1", "--base", "a"]],
  ])("%j exits 2 without a request", async (argv) => {
    expectRefusedBeforeRequest(await runCliOffline(argv));
  });
});
