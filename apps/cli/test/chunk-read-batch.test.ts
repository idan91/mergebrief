import { describe, expect, it } from "vitest";
import { ExitCodes } from "../src/exit";
import { BASE_SHA, BASE_URL, HEAD_SHA, SPAN_FLAGS } from "./harness/consts";
import {
  expectRefusedBeforeRequest,
  OFFLINE_REPO_ID,
  OFFLINE_REPOS_ROUTE,
  runCliOffline,
  type OfflineRun,
  type ScriptedRoute,
} from "./harness/offline";

const SPAN_QUERY = `base=${BASE_SHA}&head=${HEAD_SHA}`;
const PULL_PATH = `/api/repos/${OFFLINE_REPO_ID}/pulls/7`;

function makeChunkRoute(chunkId: string, verb = "read"): ScriptedRoute {
  return {
    method: "POST",
    path: `${PULL_PATH}/session/chunks/${chunkId}/${verb}?${SPAN_QUERY}`,
  };
}

function readWritePaths(run: OfflineRun): string[] {
  return run.requests
    .filter((request) => request.method === "POST")
    .map((request) => request.path);
}

const BRIEF_ROUTE: ScriptedRoute = {
  method: "GET",
  path: `${PULL_PATH}/brief?${SPAN_QUERY}`,
  body: JSON.stringify({
    chunks: [
      {
        id: "c1",
        changeGroupId: "g1",
        file: "a.ts",
        addedRanges: [],
        removedRanges: [],
      },
      {
        id: "c2",
        changeGroupId: "g2",
        file: "b.ts",
        addedRanges: [],
        removedRanges: [],
      },
      {
        id: "c3",
        changeGroupId: "g1",
        file: "c.ts",
        addedRanges: [],
        removedRanges: [],
      },
    ],
  }),
};

describe("chunk-read with several chunk ids", () => {
  it("marks each one in the order given and prints nothing", async () => {
    const run = await runCliOffline(
      ["chunk-read", "7", "c1", "c2", "c3", ...SPAN_FLAGS, "--json"],
      {
        routes: [
          OFFLINE_REPOS_ROUTE,
          makeChunkRoute("c1"),
          makeChunkRoute("c2"),
          makeChunkRoute("c3"),
        ],
      },
    );

    expect(run.code).toBe(ExitCodes.OK);
    expect(run.out).toBe("");
    expect(readWritePaths(run)).toEqual([
      makeChunkRoute("c1").path,
      makeChunkRoute("c2").path,
      makeChunkRoute("c3").path,
    ]);
  });

  it("clears each one with --unread", async () => {
    const run = await runCliOffline(
      ["chunk-read", "7", "c1", "c2", "--unread", ...SPAN_FLAGS],
      {
        routes: [
          OFFLINE_REPOS_ROUTE,
          makeChunkRoute("c1", "unread"),
          makeChunkRoute("c2", "unread"),
        ],
      },
    );

    expect(run.code).toBe(ExitCodes.OK);
    expect(readWritePaths(run)).toHaveLength(2);
  });

  it("stops at the first failure and says how far it got", async () => {
    const run = await runCliOffline(
      ["chunk-read", "7", "c1", "c2", "c3", ...SPAN_FLAGS, "--json"],
      {
        routes: [
          OFFLINE_REPOS_ROUTE,
          makeChunkRoute("c1"),
          {
            ...makeChunkRoute("c2"),
            status: 409,
            body: JSON.stringify({ error: "the PR moved" }),
          },
          makeChunkRoute("c3"),
        ],
      },
    );

    expect(run.code).toBe(ExitCodes.SERVER_REJECTED);
    expect(run.out).toBe("");
    expect(run.err).toEqual([
      "chunk c2 (1 of 3 done before it): the PR moved (HTTP 409)",
    ]);
    expect(readWritePaths(run)).toHaveLength(2);
  });

  it("keeps a rate limit's retry wait at the end of the line", async () => {
    const run = await runCliOffline(
      ["chunk-read", "7", "c1", "c2", ...SPAN_FLAGS],
      {
        routes: [
          OFFLINE_REPOS_ROUTE,
          makeChunkRoute("c1"),
          {
            ...makeChunkRoute("c2"),
            status: 429,
            headers: { "retry-after": "120" },
            body: JSON.stringify({ error: "slow down" }),
          },
        ],
      },
    );

    expect(run.code).toBe(ExitCodes.RATE_LIMITED);
    expect(run.err).toEqual([
      "chunk c2 (1 of 2 done before it): slow down (HTTP 429, retry after 120s)",
    ]);
  });

  it("keeps the other profiles at the end of the line", async () => {
    const run = await runCliOffline(
      ["chunk-read", "7", "c1", "c2", ...SPAN_FLAGS],
      {
        config: {
          defaultProfile: "default",
          profiles: {
            default: { baseUrl: BASE_URL },
            work: { baseUrl: "https://mb.work.example" },
          },
        },
        routes: [
          OFFLINE_REPOS_ROUTE,
          makeChunkRoute("c1"),
          {
            ...makeChunkRoute("c2"),
            status: 502,
            body: JSON.stringify({ error: "bad gateway" }),
          },
        ],
      },
    );

    expect(run.code).toBe(ExitCodes.GENERIC);
    expect(run.err).toEqual([
      "chunk c2 (1 of 2 done before it): bad gateway (HTTP 502); other profiles: work",
    ]);
  });

  it("leaves a lone chunk's failure line as the server gave it", async () => {
    const run = await runCliOffline(["chunk-read", "7", "c1", ...SPAN_FLAGS], {
      routes: [
        OFFLINE_REPOS_ROUTE,
        {
          ...makeChunkRoute("c1"),
          status: 409,
          body: JSON.stringify({ error: "the PR moved" }),
        },
      ],
    });

    expect(run.err).toEqual(["the PR moved (HTTP 409)"]);
  });

  it("escapes control characters in a chunk id from the brief", async () => {
    const hostileId = "c1\u001b[2J\nforged line";
    const run = await runCliOffline(
      ["chunk-read", "7", "--group", "g1", ...SPAN_FLAGS],
      {
        routes: [
          OFFLINE_REPOS_ROUTE,
          {
            ...BRIEF_ROUTE,
            body: JSON.stringify({
              chunks: [
                {
                  id: hostileId,
                  changeGroupId: "g1",
                  file: "a.ts",
                  addedRanges: [],
                  removedRanges: [],
                },
                {
                  id: "c2",
                  changeGroupId: "g1",
                  file: "b.ts",
                  addedRanges: [],
                  removedRanges: [],
                },
              ],
            }),
          },
          {
            ...makeChunkRoute(encodeURIComponent(hostileId)),
            status: 400,
            body: JSON.stringify({ error: "bad chunk" }),
          },
        ],
      },
    );

    expect(run.code).toBe(ExitCodes.SERVER_REJECTED);
    expect(run.err).toHaveLength(1);
    expect(run.err[0]).not.toContain("\u001b");
    expect(run.err[0]).not.toContain("\n");
  });
});

describe("chunk-read --group", () => {
  it("marks the group's chunks from the brief at the span named", async () => {
    const run = await runCliOffline(
      ["chunk-read", "7", "--group", "g1", ...SPAN_FLAGS, "--json"],
      {
        routes: [
          OFFLINE_REPOS_ROUTE,
          BRIEF_ROUTE,
          makeChunkRoute("c1"),
          makeChunkRoute("c3"),
        ],
      },
    );

    expect(run.code).toBe(ExitCodes.OK);
    expect(readWritePaths(run)).toEqual([
      makeChunkRoute("c1").path,
      makeChunkRoute("c3").path,
    ]);
  });

  it("exits not-found for a group the brief lacks and writes nothing", async () => {
    const run = await runCliOffline(
      ["chunk-read", "7", "--group", "g9", ...SPAN_FLAGS],
      { routes: [OFFLINE_REPOS_ROUTE, BRIEF_ROUTE] },
    );

    expect(run.code).toBe(ExitCodes.NOT_FOUND);
    expect(run.err[0]).toContain('"g9"');
    expect(readWritePaths(run)).toEqual([]);
  });
});

describe("chunk-read arguments", () => {
  it("refuses chunk ids together with --group", async () => {
    const run = await runCliOffline([
      "chunk-read",
      "7",
      "c1",
      "--group",
      "g1",
      ...SPAN_FLAGS,
    ]);

    expectRefusedBeforeRequest(run, "--group");
  });

  it("refuses neither chunk ids nor --group", async () => {
    const run = await runCliOffline(["chunk-read", "7", ...SPAN_FLAGS]);

    expectRefusedBeforeRequest(run, "--group");
  });
});
