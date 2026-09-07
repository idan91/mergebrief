// Digest sorting follows brief reading order, never bot self-assigned severity.
import { describe, expect, it } from "vitest";
import type { BriefChunk } from "../../brief/types";
import {
  buildConversationDigest,
  buildInlineThreads,
  splitInlineRows,
} from "./digest";
import type { ConversationThread, PrConversation } from "../types";
import type { Mutable } from "types";

function chunk(id: string, file: string): BriefChunk {
  return {
    id,
    changeGroupId: "g1",
    file,
    concern: "implementation",
    role: "core",
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
  const conversationThread: Mutable<ConversationThread> = {
    rootCommentId: nextId,
    path: overrides.path ?? "src/a.ts",
    side: "RIGHT",
    subjectType: "LINE",
    isResolved: overrides.isResolved ?? false,
    isOutdated: overrides.isOutdated ?? false,
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

  if (!overrides.isOutdated) conversationThread.line = overrides.line ?? 10;
  if (overrides.anchorSha !== undefined) {
    conversationThread.anchorSha = overrides.anchorSha;
  }

  return conversationThread;
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

  it("aggregates open bot counts by author and chunk group", () => {
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

  it("orders mixed LEFT/RIGHT rows by diff position", () => {
    // Chunk rows: ctx(9/9)=0, add(10)=1, add(11)=2, add(12)=3, plus a del.
    const mixedChunk = {
      ...chunk("c1", "src/a.ts"),
      diff: [
        { kind: "del", content: "gone", oldLine: 11 },
        { kind: "add", content: "b", newLine: 10 },
        { kind: "add", content: "c", newLine: 11 },
      ],
    } as BriefChunk;
    // LEFT thread on oldLine 11 sits at row 0, BEFORE the RIGHT thread on
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

  it("puts unanchored fresh threads and PR comments in the general group", () => {
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
  it("places fresh human threads inline including resolved ones", () => {
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

  it("keeps resolved bot threads in the digest and unresolved ones inline", () => {
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

  it("omits empty disclosures for all-resolved bot groups", () => {
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
  it("places human threads by diff row and bot threads by chunk group", () => {
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
