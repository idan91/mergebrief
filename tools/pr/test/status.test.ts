import { describe, expect, it } from "vitest";

import {
  deriveActivityAfterHead,
  deriveOpenThreads,
} from "../src/logic/status";
import { BOT, IDAN, makeComment, makePull, makeThread } from "./helpers";

describe("deriveOpenThreads", () => {
  it("treats a thread with no recorded reply as open", () => {
    const threads = [makeThread([makeComment(1, "2026-11-24T09:00:00Z")])];

    expect(deriveOpenThreads(threads, new Set())).toEqual([
      {
        rootId: 1,
        path: "src/a.ts",
        line: 12,
        lastAuthor: "idan91",
        lastAt: "2026-11-24T09:00:00Z",
        isOutdated: false,
      },
    ]);
  });

  it("closes a thread whose last message is a recorded reply", () => {
    const threads = [
      makeThread([
        makeComment(1, "2026-11-24T09:00:00Z"),
        makeComment(2, "2026-11-24T09:05:00Z"),
      ]),
    ];

    expect(deriveOpenThreads(threads, new Set([2]))).toEqual([]);
  });

  it("reopens a thread when someone writes after the recorded reply", () => {
    const threads = [
      makeThread([
        makeComment(1, "2026-11-24T09:00:00Z"),
        makeComment(2, "2026-11-24T09:05:00Z"),
        makeComment(3, "2026-11-24T09:10:00Z"),
      ]),
    ];

    const open = deriveOpenThreads(threads, new Set([2]));

    expect(open.map((thread) => thread.rootId)).toEqual([1]);
    expect(open[0]?.lastAt).toBe("2026-11-24T09:10:00Z");
  });

  it("skips resolved threads", () => {
    const threads = [
      makeThread([makeComment(1, "2026-11-24T09:00:00Z")], {
        isResolved: true,
      }),
    ];

    expect(deriveOpenThreads(threads, new Set())).toEqual([]);
  });

  it("keeps a bot finding open until it is answered", () => {
    const threads = [makeThread([makeComment(1, "2026-11-24T09:00:00Z", BOT)])];

    expect(deriveOpenThreads(threads, new Set())).toHaveLength(1);
  });
});

describe("deriveActivityAfterHead", () => {
  it("lists reviews and comments newer than the head commit", () => {
    const pull = makePull({
      reviews: [
        {
          id: 10,
          author: IDAN,
          state: "COMMENTED",
          submittedAt: "2026-11-24T10:30:00Z",
          commentIds: [40],
        },
        {
          id: 11,
          author: IDAN,
          state: "APPROVED",
          submittedAt: "2026-11-24T09:30:00Z",
          commentIds: [],
        },
      ],
      issueComments: [
        { id: 20, author: IDAN, createdAt: "2026-11-24T11:00:00Z" },
      ],
    });

    expect(deriveActivityAfterHead(pull, new Set())).toEqual([
      {
        kind: "review",
        author: "idan91",
        at: "2026-11-24T10:30:00Z",
        state: "COMMENTED",
      },
      { kind: "comment", author: "idan91", at: "2026-11-24T11:00:00Z" },
    ]);
  });

  it("ignores bot comments and reviews that only carry recorded replies", () => {
    const pull = makePull({
      reviews: [
        {
          id: 10,
          author: IDAN,
          state: "COMMENTED",
          submittedAt: "2026-11-24T10:30:00Z",
          commentIds: [40],
        },
      ],
      issueComments: [
        { id: 20, author: BOT, createdAt: "2026-11-24T11:00:00Z" },
      ],
    });

    expect(deriveActivityAfterHead(pull, new Set([40]))).toEqual([]);
  });
});
