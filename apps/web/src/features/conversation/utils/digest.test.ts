// Digest view-model builder (BRIEF-25, locked decisions 5/6): threads
// grouped by chunk in READING ORDER (the Brief's structure, not GitHub's
// feed), unresolved first within a group; humans one row per thread; bots
// one aggregated row per (bot author, chunk-group) with per-thread rows on
// expand; resolved/outdated bot threads never inline (digest-only is the
// section itself); outdated threads in their own revision-labeled group;
// unanchored + PR-level comments in the general group. Sorting never uses
// bot self-assigned severity.
import { describe, expect, it } from "vitest";
import type { BriefChunk } from "../../brief/types";
import {
  buildConversationDigest,
  buildInlineThreads,
  splitInlineRows,
} from "./digest";
import type { ConversationThread, PrConversation } from "../types";

function chunk(id: string, file: string): BriefChunk {
  return {
    id,
    changeGroupId: "g1",
    file,
    concern: "implementation",
    role: "carrier",
    loc: { added: 1, deleted: 0 },
    addedRanges: [],
    removedRanges: [],
    riskSurface: [],
    diff: [
      { kind: "ctx", content: "a", oldLine: 9, newLine: 9 },
      { kind: "add", content: "b", newLine: 10 },
      { kind: "add", content: "c", newLine: 11 },
      { kind: "add", content: "d", newLine: 12 },
    ],
  } as BriefChunk;
}

let nextId = 1000;
function thread(overrides: {
  path?: string;
  line?: number;
  isResolved?: boolean;
  isOutdated?: boolean;
  login?: string;
  isBot?: boolean;
  body?: string;
  anchorSha?: string;
}): ConversationThread {
  nextId += 1;
  return {
    rootCommentId: nextId,
    path: overrides.path ?? "src/a.ts",
    ...(overrides.isOutdated ? {} : { line: overrides.line ?? 10 }),
    side: "RIGHT",
    subjectType: "LINE",
    isResolved: overrides.isResolved ?? false,
    isOutdated: overrides.isOutdated ?? false,
    ...(overrides.anchorSha === undefined
      ? {}
      : { anchorSha: overrides.anchorSha }),
    comments: [
      {
        commentId: nextId,
        author: {
          login: overrides.login ?? "alice",
          isBot: overrides.isBot ?? false,
        },
        body: overrides.body ?? "a note",
        createdAt: "2026-07-01T10:00:00Z",
        url: `https://example.test/c/${nextId}`,
      },
    ],
    hasMoreComments: false,
  };
}

function conversation(threads: ConversationThread[]): PrConversation {
  return {
    threads,
    reviews: [],
    prComments: [],
    hasMoreThreads: false,
    hasMoreReviews: false,
    hasMorePrComments: false,
  };
}

const CHUNKS = [chunk("c1", "src/a.ts"), chunk("c2", "src/b.ts")];

describe("buildConversationDigest", () => {
  it("groups threads by chunk in the Brief's reading order", () => {
    const t1 = thread({ path: "src/b.ts", line: 10 });
    const t2 = thread({ path: "src/a.ts", line: 10 });
    const groups = buildConversationDigest({
      conversation: conversation([t1, t2]),
      chunks: CHUNKS,
      ownThreadIds: new Set(),
    });
    expect(groups.map((group) => group.id)).toEqual(["chunk:c1", "chunk:c2"]);
    expect(groups[0]?.chunkId).toBe("c1");
  });

  it("sorts unresolved before resolved within a group, then reading order", () => {
    const resolved = thread({ line: 10, isResolved: true });
    const openLate = thread({ line: 12 });
    const openEarly = thread({ line: 11 });
    const groups = buildConversationDigest({
      conversation: conversation([resolved, openLate, openEarly]),
      chunks: CHUNKS,
      ownThreadIds: new Set(),
    });
    const rows = groups[0]?.rows ?? [];
    const ids = rows.flatMap((row) =>
      row.kind === "thread" ? [row.thread.rootCommentId] : [],
    );
    expect(ids).toEqual([
      openEarly.rootCommentId,
      openLate.rootCommentId,
      resolved.rootCommentId,
    ]);
  });

  it("aggregates bot threads into one row per (bot, chunk group) with open counts", () => {
    const bot1 = thread({ login: "coderabbitai", isBot: true, line: 10 });
    const bot2 = thread({
      login: "coderabbitai",
      isBot: true,
      line: 11,
      isResolved: true,
    });
    const human = thread({ login: "alice", line: 12 });
    const groups = buildConversationDigest({
      conversation: conversation([bot1, bot2, human]),
      chunks: CHUNKS,
      ownThreadIds: new Set(),
    });
    const rows = groups[0]?.rows ?? [];
    const botRow = rows.find((row) => row.kind === "bot-group");
    if (botRow?.kind !== "bot-group") throw new Error("expected a bot group");
    expect(botRow.author).toBe("coderabbitai");
    expect(botRow.threads).toHaveLength(2);
    expect(botRow.openCount).toBe(1);
    // The human thread stays its own row.
    expect(rows.filter((row) => row.kind === "thread")).toHaveLength(1);
  });

  it("orders mixed LEFT/RIGHT rows by their diff-row position, not raw line numbers", () => {
    // Chunk rows: ctx(9/9)=0, add(10)=1, add(11)=2, add(12)=3 — plus a del.
    const mixedChunk = {
      ...chunk("c1", "src/a.ts"),
      diff: [
        { kind: "del", content: "gone", oldLine: 11 },
        { kind: "add", content: "b", newLine: 10 },
        { kind: "add", content: "c", newLine: 11 },
      ],
    } as BriefChunk;
    // LEFT thread on oldLine 11 sits at row 0 — BEFORE the RIGHT thread on
    // newLine 10 (row 1), even though 11 > 10 numerically.
    const leftThread: ConversationThread = {
      ...thread({ line: 11 }),
      side: "LEFT",
    };
    const rightThread = thread({ line: 10 });
    const groups = buildConversationDigest({
      conversation: conversation([rightThread, leftThread]),
      chunks: [mixedChunk],
      ownThreadIds: new Set(),
    });
    const ids = (groups[0]?.rows ?? []).flatMap((row) =>
      row.kind === "thread" ? [row.thread.rootCommentId] : [],
    );
    expect(ids).toEqual([leftThread.rootCommentId, rightThread.rootCommentId]);
  });

  it("puts outdated threads in a revision-labeled group, never a chunk group", () => {
    const outdated = thread({ isOutdated: true, anchorSha: "b".repeat(40) });
    const fresh = thread({ line: 10 });
    const groups = buildConversationDigest({
      conversation: conversation([outdated, fresh]),
      chunks: CHUNKS,
      ownThreadIds: new Set(),
    });
    const outdatedGroup = groups.find((group) => group.kind === "outdated");
    expect(outdatedGroup).toBeDefined();
    const row = outdatedGroup?.rows[0];
    if (row?.kind !== "thread") throw new Error("expected a thread row");
    expect(row.thread.rootCommentId).toBe(outdated.rootCommentId);
    expect(row.anchorLabel).toBe("bbbbbbb");
  });

  it("routes unanchored fresh threads and PR-level comments to the general group", () => {
    const renamed = thread({ path: "src/gone.ts", line: 10 });
    const convo = {
      ...conversation([renamed]),
      prComments: [
        {
          commentId: 9001,
          author: { login: "carol", isBot: false },
          body: "PR-level remark",
          createdAt: "2026-07-02T09:00:00Z",
          url: "https://example.test/i/9001",
        },
      ],
    };
    const groups = buildConversationDigest({
      conversation: convo,
      chunks: CHUNKS,
      ownThreadIds: new Set(),
    });
    const general = groups.find((group) => group.kind === "general");
    expect(general).toBeDefined();
    expect(general?.rows).toHaveLength(1);
    expect(general?.prComments).toHaveLength(1);
  });

  it("marks own threads from the reconciliation set", () => {
    const own = thread({ line: 10 });
    const groups = buildConversationDigest({
      conversation: conversation([own]),
      chunks: CHUNKS,
      ownThreadIds: new Set([own.rootCommentId]),
    });
    const row = groups[0]?.rows[0];
    if (row?.kind !== "thread") throw new Error("expected thread row");
    expect(row.isOwn).toBe(true);
  });

  it("derives each row's one-liner through the digest-line spec", () => {
    const noisy = thread({
      line: 10,
      body: "## Walkthrough\n\nReal point here.",
    });
    const groups = buildConversationDigest({
      conversation: conversation([noisy]),
      chunks: CHUNKS,
      ownThreadIds: new Set(),
    });
    const row = groups[0]?.rows[0];
    if (row?.kind !== "thread") throw new Error("expected thread row");
    expect(row.digestLine).toBe("Real point here.");
  });

  it("returns no groups for an empty conversation", () => {
    expect(
      buildConversationDigest({
        conversation: conversation([]),
        chunks: CHUNKS,
        ownThreadIds: new Set(),
      }),
    ).toEqual([]);
  });
});

describe("buildInlineThreads", () => {
  it("puts fresh human threads inline at their chunk (resolved included, collapsed later)", () => {
    const openThread = thread({ line: 10 });
    const resolved = thread({ line: 11, isResolved: true });
    const inline = buildInlineThreads({
      conversation: conversation([openThread, resolved]),
      chunks: CHUNKS,
      ownThreadIds: new Set(),
    });
    const rows = inline.get("c1") ?? [];
    const ids = rows.flatMap((row) =>
      row.kind === "thread" ? [row.thread.rootCommentId] : [],
    );
    expect(ids).toEqual([openThread.rootCommentId, resolved.rootCommentId]);
  });

  it("aggregates only UNRESOLVED bot threads inline; resolved bot threads stay digest-only", () => {
    const botOpen = thread({ login: "coderabbitai", isBot: true, line: 10 });
    const botResolved = thread({
      login: "coderabbitai",
      isBot: true,
      line: 11,
      isResolved: true,
    });
    const inline = buildInlineThreads({
      conversation: conversation([botOpen, botResolved]),
      chunks: CHUNKS,
      ownThreadIds: new Set(),
    });
    const rows = inline.get("c1") ?? [];
    const botRow = rows.find((row) => row.kind === "bot-group");
    if (botRow?.kind !== "bot-group") throw new Error("expected bot group");
    expect(botRow.threads).toHaveLength(1);
    expect(botRow.threads[0]?.thread.rootCommentId).toBe(botOpen.rootCommentId);
  });

  it("never inlines outdated or unanchored threads", () => {
    const outdated = thread({ isOutdated: true });
    const renamed = thread({ path: "src/gone.ts", line: 10 });
    const inline = buildInlineThreads({
      conversation: conversation([outdated, renamed]),
      chunks: CHUNKS,
      ownThreadIds: new Set(),
    });
    expect(inline.size).toBe(0);
  });

  it("drops an all-resolved bot group entirely (no empty disclosure)", () => {
    const botResolved = thread({
      login: "coderabbitai",
      isBot: true,
      line: 10,
      isResolved: true,
    });
    const inline = buildInlineThreads({
      conversation: conversation([botResolved]),
      chunks: CHUNKS,
      ownThreadIds: new Set(),
    });
    expect(inline.get("c1")).toBeUndefined();
  });
});

describe("splitInlineRows", () => {
  it("routes human threads to their diff-row index and bots to chunk-level groups", () => {
    const human = thread({ line: 10 });
    const bot = thread({ login: "coderabbitai", isBot: true, line: 11 });
    const rows =
      buildInlineThreads({
        conversation: conversation([human, bot]),
        chunks: CHUNKS,
        ownThreadIds: new Set(),
      }).get("c1") ?? [];
    const split = splitInlineRows(rows);
    // chunk c1 diff: ctx(9)=0, add(10)=1, add(11)=2, add(12)=3.
    expect([...split.byRow.keys()]).toEqual([1]);
    expect(split.byRow.get(1)?.[0]?.thread.rootCommentId).toBe(
      human.rootCommentId,
    );
    expect(split.botGroups).toHaveLength(1);
    expect(split.botGroups[0]?.author).toBe("coderabbitai");
  });
});
