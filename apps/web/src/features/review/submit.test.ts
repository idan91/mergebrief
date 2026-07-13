import { describe, expect, it } from "vitest";

import type { CommentAnchor, ReviewComment } from "./comments";
import type { Receipt } from "./receipt";
import {
  buildSignatureLine,
  buildSubmitPayload,
  mapAnchorToWire,
  submitBlockedReason,
} from "./submit";

const COMMIT_ID = "c".repeat(40);

function anchor(overrides: Partial<CommentAnchor> = {}): CommentAnchor {
  return {
    chunkId: "chunk-1",
    file: "src/a.ts",
    side: "new",
    startLine: 12,
    endLine: 12,
    rowIds: ["chunk-1:0"],
    selectedText: "const x = 1;",
    ...overrides,
  };
}

function comment(
  id: string,
  anchorOverrides: Partial<CommentAnchor> = {},
  body = "note",
): ReviewComment {
  return {
    id,
    anchor: anchor(anchorOverrides),
    body,
    status: "draft",
    collapsed: false,
  };
}

describe("mapAnchorToWire", () => {
  it("maps a single-line new-side anchor to RIGHT with no startLine", () => {
    const wire = mapAnchorToWire(
      anchor({ side: "new", startLine: 12, endLine: 12 }),
    );
    expect(wire).toEqual({
      path: "src/a.ts",
      line: 12,
      side: "RIGHT",
      selectedText: "const x = 1;",
    });
  });

  it("maps an old-side anchor to LEFT", () => {
    const wire = mapAnchorToWire(
      anchor({ side: "old", startLine: 5, endLine: 5 }),
    );
    expect(wire.side).toBe("LEFT");
    expect(wire.line).toBe(5);
  });

  it("maps a multi-line anchor to line=end + startLine/startSide", () => {
    const wire = mapAnchorToWire(
      anchor({ side: "new", startLine: 10, endLine: 14 }),
    );
    expect(wire).toEqual({
      path: "src/a.ts",
      line: 14,
      side: "RIGHT",
      startLine: 10,
      startSide: "RIGHT",
      selectedText: "const x = 1;",
    });
  });
});

describe("buildSubmitPayload", () => {
  it("assembles outcome, commitId, and mapped comments", () => {
    const payload = buildSubmitPayload({
      outcome: "request-changes",
      commitId: COMMIT_ID,
      body: "Reviewed with MergeBrief — signature",
      comments: [
        comment("a", { side: "new", startLine: 12, endLine: 12 }, "first"),
        comment(
          "b",
          { file: "src/b.ts", side: "old", startLine: 3, endLine: 7 },
          "second",
        ),
      ],
    });
    expect(payload).toEqual({
      outcome: "request-changes",
      commitId: COMMIT_ID,
      body: "Reviewed with MergeBrief — signature",
      comments: [
        {
          path: "src/a.ts",
          line: 12,
          side: "RIGHT",
          selectedText: "const x = 1;",
          body: "first",
        },
        {
          path: "src/b.ts",
          line: 7,
          side: "LEFT",
          startLine: 3,
          startSide: "LEFT",
          selectedText: "const x = 1;",
          body: "second",
        },
      ],
    });
  });

  it("only submits draft comments — already-submitted ones stay behind", () => {
    const submitted: ReviewComment = {
      ...comment("old-one"),
      status: "submitted",
    };
    const payload = buildSubmitPayload({
      outcome: "comment",
      commitId: COMMIT_ID,
      comments: [submitted, comment("new-one", {}, "fresh")],
    });
    expect(payload.comments).toHaveLength(1);
    expect(payload.comments[0]?.body).toBe("fresh");
  });
});

describe("mapAnchorToWire — route-cap alignment", () => {
  it("trims an oversized selectedText to the route's quote budget", () => {
    // The route caps selectedText at 4000 chars (quote metadata only) — an
    // over-long selection must not 400 an otherwise valid comment.
    const wire = mapAnchorToWire(anchor({ selectedText: "x".repeat(9_000) }));
    expect(wire.selectedText?.length).toBe(4_000);
  });
});

describe("buildSignatureLine", () => {
  const receipt: Receipt = {
    subject: { repo: "octo/hello", number: 7, sha: "c".repeat(40) },
    progress: { reviewedChunks: 12, chunkTotal: 14, flagTotal: 6 },
    counts: { addressed: 2, dismissed: 1, open: 3 },
    addressed: [],
    dismissed: [],
    open: [],
    comments: [],
    reclassifiedCount: 0,
  };

  it("renders one line of mechanical claims", () => {
    const line = buildSignatureLine(receipt, 2);
    expect(line).toBe(
      "Reviewed with MergeBrief — 12/14 chunks read · 2 risks addressed · 1 dismissed · 3 open · 2 inline comments",
    );
    expect(line).not.toContain("\n");
  });

  it("is never empty (the review body requirement rides on it)", () => {
    const empty: Receipt = {
      ...receipt,
      progress: { reviewedChunks: 0, chunkTotal: 0, flagTotal: 0 },
      counts: { addressed: 0, dismissed: 0, open: 0 },
    };
    expect(buildSignatureLine(empty, 0).trim().length).toBeGreaterThan(0);
  });
});

describe("submitBlockedReason", () => {
  it("blocks a neutral comment submit with nothing to say", () => {
    expect(submitBlockedReason("comment", [])).toMatch(/at least one comment/i);
  });

  it("allows a neutral comment submit with a draft comment", () => {
    expect(submitBlockedReason("comment", [comment("a")])).toBeUndefined();
  });

  it("blocks a comment-outcome submit whose drafts were all already submitted", () => {
    const submitted: ReviewComment = { ...comment("a"), status: "submitted" };
    expect(submitBlockedReason("comment", [submitted])).toMatch(
      /at least one comment/i,
    );
  });

  it("allows approve and request-changes without comments", () => {
    expect(submitBlockedReason("approve", [])).toBeUndefined();
    expect(submitBlockedReason("request-changes", [])).toBeUndefined();
  });

  it("blocks a submit past the route's 100-comment cap with reachable copy", () => {
    const drafts = Array.from({ length: 101 }, (_, index) =>
      comment(`c${index}`),
    );
    expect(submitBlockedReason("approve", drafts)).toMatch(/100/);
    expect(
      submitBlockedReason("approve", drafts.slice(0, 100)),
    ).toBeUndefined();
  });

  it("blocks a draft anchored to a path past the route's length cap", () => {
    const longPath = `src/${"a".repeat(1_100)}.ts`;
    const drafts = [comment("a", { file: longPath })];
    expect(submitBlockedReason("approve", drafts)).toMatch(/path.*too long/i);
    expect(
      submitBlockedReason("approve", [comment("b", { file: "src/ok.ts" })]),
    ).toBeUndefined();
  });

  it("blocks a submit whose folded rendering would exceed the route's body budget", () => {
    // Two comments within every per-field cap, but together past the fold
    // budget the route pre-validates — the route would 400 this same payload
    // on every retry, so it must block HERE with recoverable copy.
    const drafts = [
      comment("a", {}, "x".repeat(40_000)),
      comment("b", {}, "y".repeat(40_000)),
    ];
    expect(submitBlockedReason("approve", drafts)).toMatch(
      /too large|shorten/i,
    );
    expect(
      submitBlockedReason("approve", [comment("a", {}, "x".repeat(1_000))]),
    ).toBeUndefined();
  });
});
