import { describe, expect, it } from "vitest";
import { createI18n } from "i18n";
import { CommentAnchorKinds } from "types";

import {
  createFileCommentAnchor,
  type LineCommentAnchor,
  type ReviewComment,
  CommentSides,
  ReviewCommentStatuses,
} from "./comments";
import type { Receipt } from "./receipt";
import { ThreadSides } from "@web/features/conversation/types";
import {
  buildReviewBody,
  buildSignatureLine,
  buildSubmitPayload,
  mapAnchorToWire,
  submitBlockedReason,
} from "./submit";

const t = createI18n().t;

function anchor(overrides: Partial<LineCommentAnchor> = {}): LineCommentAnchor {
  return {
    kind: CommentAnchorKinds.LINE,
    chunkId: "chunk-1",
    file: "src/a.ts",
    side: CommentSides.NEW,
    startLine: 12,
    endLine: 12,
    rowIds: ["chunk-1:0"],
    selectedText: "const x = 1;",
    ...overrides,
  };
}

function comment(
  id: string,
  anchorOverrides: Partial<LineCommentAnchor> = {},
  body = "note",
): ReviewComment {
  return {
    id,
    anchor: anchor(anchorOverrides),
    body,
    status: ReviewCommentStatuses.DRAFT,
    collapsed: false,
  };
}

describe("mapAnchorToWire", () => {
  it("maps a single-line new-side anchor to RIGHT with no startLine", () => {
    const wire = mapAnchorToWire(
      anchor({ side: CommentSides.NEW, startLine: 12, endLine: 12 }),
    );
    expect(wire).toEqual({
      path: "src/a.ts",
      line: 12,
      side: ThreadSides.RIGHT,
      selectedText: "const x = 1;",
    });
  });

  it("maps a crossing anchor with its own start side, even on equal lines", () => {
    const wire = mapAnchorToWire(
      anchor({
        side: CommentSides.NEW,
        startSide: CommentSides.OLD,
        startLine: 10,
        endLine: 10,
      }),
    );
    expect(wire).toEqual({
      path: "src/a.ts",
      line: 10,
      side: ThreadSides.RIGHT,
      startLine: 10,
      startSide: ThreadSides.LEFT,
      selectedText: "const x = 1;",
    });
  });

  it("maps an old-side anchor to LEFT", () => {
    const wire = mapAnchorToWire(
      anchor({ side: CommentSides.OLD, startLine: 5, endLine: 5 }),
    );
    expect(wire.side).toBe(ThreadSides.LEFT);
    expect(wire.line).toBe(5);
  });

  it("maps a multi-line anchor to line=end + startLine/startSide", () => {
    const wire = mapAnchorToWire(
      anchor({ side: CommentSides.NEW, startLine: 10, endLine: 14 }),
    );
    expect(wire).toEqual({
      path: "src/a.ts",
      line: 14,
      side: ThreadSides.RIGHT,
      startLine: 10,
      startSide: ThreadSides.RIGHT,
      selectedText: "const x = 1;",
    });
  });

  it("maps a file anchor to path only, with no line", () => {
    expect(mapAnchorToWire(createFileCommentAnchor("src/a.ts"))).toEqual({
      path: "src/a.ts",
    });
  });
});

describe("buildSubmitPayload", () => {
  it("carries the outcome and body, never the drafts the session holds", () => {
    expect(
      buildSubmitPayload({
        outcome: "request-changes",
        body: "Reviewed with MergeBrief — signature",
      }),
    ).toEqual({
      outcome: "request-changes",
      body: "Reviewed with MergeBrief — signature",
    });
  });

  it("omits an absent body rather than sending undefined", () => {
    expect(buildSubmitPayload({ outcome: "comment" })).toEqual({
      outcome: "comment",
    });
  });
});

describe("mapAnchorToWire route-cap alignment", () => {
  it("trims an oversized selectedText to the route's quote budget", () => {
    // The route caps selectedText at 4000 chars. An over-long selection
    // must not 400 an otherwise valid comment.
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

  it("is never empty because the review body requires it", () => {
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
    expect(submitBlockedReason(t, "comment", [])).toMatch(
      /at least one comment/i,
    );
  });

  it("allows a neutral comment submit with a draft comment", () => {
    expect(submitBlockedReason(t, "comment", [comment("a")])).toBeUndefined();
  });

  it("blocks a comment submit whose drafts were already submitted", () => {
    const submitted: ReviewComment = {
      ...comment("a"),
      status: ReviewCommentStatuses.SUBMITTED,
    };
    expect(submitBlockedReason(t, "comment", [submitted])).toMatch(
      /at least one comment/i,
    );
  });

  it("allows approve and request-changes without comments", () => {
    expect(submitBlockedReason(t, "approve", [])).toBeUndefined();
    expect(submitBlockedReason(t, "request-changes", [])).toBeUndefined();
  });

  it("blocks a submit past the route's 100-comment cap with reachable copy", () => {
    const drafts = Array.from({ length: 101 }, (_, index) =>
      comment(`c${index}`),
    );
    expect(submitBlockedReason(t, "approve", drafts)).toMatch(/100/);
    expect(
      submitBlockedReason(t, "approve", drafts.slice(0, 100)),
    ).toBeUndefined();
  });

  it("blocks a draft anchored to a path past the route's length cap", () => {
    const longPath = `src/${"a".repeat(1_100)}.ts`;
    const drafts = [comment("a", { file: longPath })];
    expect(submitBlockedReason(t, "approve", drafts)).toMatch(
      /path.*too long/i,
    );
    expect(
      submitBlockedReason(t, "approve", [comment("b", { file: "src/ok.ts" })]),
    ).toBeUndefined();
  });

  it("blocks a submit whose fold would exceed the route body budget", () => {
    // Two comments within every per-field cap, but together past the fold
    // budget the route pre-validates. The route would 400 this same payload
    // on every retry, so it must block HERE with recoverable copy.
    const drafts = [
      comment("a", {}, "x".repeat(40_000)),
      comment("b", {}, "y".repeat(40_000)),
    ];
    expect(submitBlockedReason(t, "approve", drafts)).toMatch(
      /too large|shorten/i,
    );
    expect(
      submitBlockedReason(t, "approve", [comment("a", {}, "x".repeat(1_000))]),
    ).toBeUndefined();
  });

  it("allows a neutral comment submit with only a review comment", () => {
    expect(
      submitBlockedReason(t, "comment", [], "Looks fine overall."),
    ).toBeUndefined();
    expect(submitBlockedReason(t, "comment", [], "   ")).toMatch(
      /at least one comment/i,
    );
  });

  it("counts the review comment toward the fold budget in the copy", () => {
    // One inline draft near the budget: an oversize review comment must tip
    // the same pre-validation the route runs, with copy that points at the
    // review comment as a thing to shorten.
    const drafts = [comment("a", {}, "x".repeat(40_000))];
    expect(
      submitBlockedReason(t, "approve", drafts, "r".repeat(30_000)),
    ).toMatch(/review comment/i);
    expect(
      submitBlockedReason(t, "approve", drafts, "short note"),
    ).toBeUndefined();
  });
});

describe("buildReviewBody", () => {
  it("is the signature alone for an empty or whitespace comment", () => {
    expect(buildReviewBody("", "sig")).toBe("sig");
    expect(buildReviewBody("   \n ", "sig")).toBe("sig");
  });

  it("fences the trimmed comment above the signature with a rule", () => {
    expect(buildReviewBody("  Solid change. ", "sig")).toBe(
      "Solid change.\n\n---\n\nsig",
    );
  });
});
