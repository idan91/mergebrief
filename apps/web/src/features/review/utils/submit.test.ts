import { RequestBounds } from "contract";
import { describe, expect, it } from "vitest";
import { createI18n } from "i18n";
import {
  CommentAnchorKinds,
  DiffSides,
  DraftCommentStatuses,
} from "types/comments";

import {
  createFileCommentAnchor,
  type LineCommentAnchor,
  type ReviewComment,
} from "./comments";
import type { Receipt } from "./receipt";
import type { SessionDraftComment } from "../session/serverState";
import {
  buildReviewBody,
  buildSignatureLine,
  buildSubmitPayload,
  foldDraftsIntoBody,
  listUnplacedDrafts,
  submitBlockedReason,
  type SubmitBlockInput,
} from "./submit";

const t = createI18n().t;
const SIGNATURE = "Reviewed with MergeBrief, fixture signature";

function anchor(overrides: Partial<LineCommentAnchor> = {}): LineCommentAnchor {
  return {
    kind: CommentAnchorKinds.LINE,
    chunkId: "chunk-1",
    file: "src/a.ts",
    side: DiffSides.NEW,
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
    status: DraftCommentStatuses.DRAFT,
    collapsed: false,
  };
}

function getBlockedReason(
  input: Partial<SubmitBlockInput>,
): string | undefined {
  const reviewComment = input.reviewComment ?? "";
  return submitBlockedReason(t, {
    outcome: "outcome" in input ? input.outcome : "approve",
    comments: input.comments ?? [],
    unplacedDrafts: input.unplacedDrafts ?? [],
    reviewComment,
    reviewBody: input.reviewBody ?? buildReviewBody(reviewComment, SIGNATURE),
  });
}

function makeUnplacedDraft(
  overrides: Partial<SessionDraftComment> = {},
): SessionDraftComment {
  return {
    id: "unplaced",
    filePath: "src/gone.ts",
    kind: CommentAnchorKinds.FILE,
    body: "left the brief",
    status: DraftCommentStatuses.DRAFT,
    ...overrides,
  } as SessionDraftComment;
}

/** One draft whose body pads the fold under `reviewBody` to `foldLength`. */
function makeDraftFillingFold(
  reviewBody: string,
  foldLength: number,
): ReviewComment {
  const empty = comment("filling", {}, "");
  const emptyLength = foldDraftsIntoBody(reviewBody, [empty], []).length;
  return comment("filling", {}, "x".repeat(foldLength - emptyLength));
}

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
});

describe("submitBlockedReason", () => {
  it("blocks a neutral comment submit with nothing to say", () => {
    expect(getBlockedReason({ outcome: "comment" })).toMatch(
      /at least one comment/i,
    );
  });

  it("allows a neutral comment submit with a draft comment", () => {
    expect(
      getBlockedReason({ outcome: "comment", comments: [comment("a")] }),
    ).toBeUndefined();
  });

  it("blocks a comment submit whose drafts were already submitted", () => {
    const submitted: ReviewComment = {
      ...comment("a"),
      status: DraftCommentStatuses.SUBMITTED,
    };
    expect(
      getBlockedReason({ outcome: "comment", comments: [submitted] }),
    ).toMatch(/at least one comment/i);
  });

  it("blocks a submit until a reviewer picks an outcome", () => {
    expect(
      getBlockedReason({ outcome: undefined, comments: [comment("a")] }),
    ).toBe(t("review.submit.outcomeNeeded"));
  });

  it("allows approve and request-changes without comments", () => {
    expect(getBlockedReason({ outcome: "approve" })).toBeUndefined();
    expect(getBlockedReason({ outcome: "request-changes" })).toBeUndefined();
  });

  it("allows any number of drafts the fold can carry", () => {
    const drafts = Array.from({ length: 65 }, (_, index) =>
      comment(`c${String(index)}`),
    );
    expect(getBlockedReason({ comments: drafts })).toBeUndefined();
  });

  it("blocks a draft anchored to a path past the route's length cap", () => {
    const longPath = `src/${"a".repeat(1_100)}.ts`;
    expect(
      getBlockedReason({ comments: [comment("a", { file: longPath })] }),
    ).toMatch(/path.*too long/i);
    expect(
      getBlockedReason({ comments: [comment("b", { file: "src/ok.ts" })] }),
    ).toBeUndefined();
  });

  it("allows a fold of exactly the route's body cap", () => {
    const drafts = [makeDraftFillingFold(SIGNATURE, RequestBounds.BODY_LENGTH)];
    expect(foldDraftsIntoBody(SIGNATURE, drafts, [])).toHaveLength(
      RequestBounds.BODY_LENGTH,
    );
    expect(getBlockedReason({ comments: drafts })).toBeUndefined();
  });

  it("blocks a fold one character past the body cap", () => {
    const drafts = [
      makeDraftFillingFold(SIGNATURE, RequestBounds.BODY_LENGTH + 1),
    ];
    expect(getBlockedReason({ comments: drafts })).toMatch(
      /too large|shorten/i,
    );
  });

  it("counts an unplaced draft toward the fold", () => {
    const drafts = [makeDraftFillingFold(SIGNATURE, RequestBounds.BODY_LENGTH)];
    expect(getBlockedReason({ comments: drafts })).toBeUndefined();
    expect(
      getBlockedReason({
        comments: drafts,
        unplacedDrafts: [makeUnplacedDraft()],
      }),
    ).toMatch(/too large|shorten/i);
  });

  it("leaves an unplaced draft out once it is submitted", () => {
    const drafts = [makeDraftFillingFold(SIGNATURE, RequestBounds.BODY_LENGTH)];
    const posted = makeUnplacedDraft({
      status: DraftCommentStatuses.SUBMITTED,
    });
    expect(
      getBlockedReason({ comments: drafts, unplacedDrafts: [posted] }),
    ).toBeUndefined();
  });

  it("counts a draft of an unknown anchor toward the fold", () => {
    const drafts = [makeDraftFillingFold(SIGNATURE, RequestBounds.BODY_LENGTH)];
    const held = makeUnplacedDraft({ id: "held", kind: "unknown" });
    expect(
      getBlockedReason({ comments: drafts, unplacedDrafts: [held] }),
    ).toMatch(/too large|shorten/i);
    expect(listUnplacedDrafts([held, makeUnplacedDraft()])).toEqual([
      held,
      makeUnplacedDraft(),
    ]);
  });

  it("folds a draft of an unknown anchor as a path-only block", () => {
    const held = makeUnplacedDraft({ kind: "unknown", body: "held body" });
    expect(foldDraftsIntoBody("", [], [held])).toContain(
      "**`src/gone.ts`**\n\nheld body",
    );
    expect(foldDraftsIntoBody("", [], [held])).toHaveLength(
      foldDraftsIntoBody("", [], [makeUnplacedDraft({ body: "held body" })])
        .length,
    );
  });

  it("lets a draft of an unknown anchor alone give submit content", () => {
    expect(
      getBlockedReason({
        outcome: "comment",
        unplacedDrafts: [makeUnplacedDraft({ kind: "unknown" })],
      }),
    ).toBeUndefined();
  });

  it("leaves a draft of an unknown anchor out once it is submitted", () => {
    const held = makeUnplacedDraft({
      kind: "unknown",
      status: DraftCommentStatuses.SUBMITTED,
    });
    expect(listUnplacedDrafts([held])).toEqual([]);
  });

  it("lets an unplaced draft alone give a neutral submit content", () => {
    expect(
      getBlockedReason({
        outcome: "comment",
        unplacedDrafts: [makeUnplacedDraft()],
      }),
    ).toBeUndefined();
  });

  it("ignores the quoted selection when sizing the fold", () => {
    const filling = makeDraftFillingFold(SIGNATURE, RequestBounds.BODY_LENGTH);
    const quoting: ReviewComment = {
      ...filling,
      anchor: anchor({ selectedText: "q".repeat(10_000) }),
    };
    expect(foldDraftsIntoBody(SIGNATURE, [quoting], [])).toBe(
      foldDraftsIntoBody(SIGNATURE, [filling], []),
    );
    expect(getBlockedReason({ comments: [quoting] })).toBeUndefined();
  });

  it("allows a neutral comment submit with only a review comment", () => {
    expect(
      getBlockedReason({
        outcome: "comment",
        reviewComment: "Looks fine overall.",
      }),
    ).toBeUndefined();
    expect(
      getBlockedReason({ outcome: "comment", reviewComment: "   " }),
    ).toMatch(/at least one comment/i);
  });

  it("names the review comment in the copy when it tips the fold", () => {
    const reviewComment = "r".repeat(30_000);
    const reviewBody = buildReviewBody(reviewComment, SIGNATURE);
    const drafts = [comment("a", {}, "x".repeat(40_000))];
    expect(
      getBlockedReason({ comments: drafts, reviewComment, reviewBody }),
    ).toMatch(/review comment/i);
    expect(
      getBlockedReason({
        comments: drafts,
        reviewComment: "short note",
        reviewBody: buildReviewBody("short note", SIGNATURE),
      }),
    ).toBeUndefined();
  });
});

describe("foldDraftsIntoBody", () => {
  it("returns the review body untouched when there are no drafts", () => {
    expect(foldDraftsIntoBody("overall verdict", [], [])).toBe(
      "overall verdict",
    );
  });

  it("folds the fixture the api fold test pins to the same length", () => {
    // The api fold test holds a literal copy of this fixture and length:
    // apps/api/src/routes/repos/pr/publish/logic/fold.test.ts.
    // Change both or neither.
    const drafts: ReviewComment[] = [
      {
        ...comment("file", {}, "on the file 🧪"),
        anchor: createFileCommentAnchor("src/app.ts"),
      },
      comment(
        "line",
        { file: "src/a.ts", startLine: 12, endLine: 12 },
        "anchored note",
      ),
      comment(
        "range",
        {
          file: "src/b.ts",
          side: DiffSides.OLD,
          startLine: 25,
          endLine: 30,
        },
        "range note",
      ),
      comment(
        "crossing",
        {
          file: "src/c.ts",
          side: DiffSides.NEW,
          startSide: DiffSides.OLD,
          startLine: 10,
          endLine: 10,
        },
        "crossing note 𝔸",
      ),
    ];

    const folded = foldDraftsIntoBody(
      "Looks right 🚀\n\n---\n\nsignature line",
      drafts,
      [],
    );

    expect(folded).toHaveLength(305);
  });

  it("folds unplaced and placed drafts to the route's length", () => {
    // The api fold test holds a literal copy of this fixture and length.
    // Change both or neither.
    const placed: ReviewComment[] = [
      {
        ...comment("file", {}, "on the file 🧪"),
        anchor: createFileCommentAnchor("src/app.ts"),
      },
      comment(
        "line",
        { file: "src/a.ts", startLine: 12, endLine: 12 },
        "anchored note",
      ),
    ];
    const unplaced: SessionDraftComment[] = [
      makeUnplacedDraft({ id: "gone-file", body: "gone file 🧹" }),
      {
        id: "gone-range",
        filePath: "src/gone.ts",
        kind: CommentAnchorKinds.LINE,
        side: DiffSides.OLD,
        startLine: 4,
        endLine: 6,
        body: "gone range",
        status: DraftCommentStatuses.DRAFT,
      },
      {
        id: "gone-crossing",
        filePath: "src/gone.ts",
        kind: CommentAnchorKinds.LINE,
        side: DiffSides.NEW,
        startSide: DiffSides.OLD,
        startLine: 8,
        endLine: 9,
        body: "gone crossing",
        status: DraftCommentStatuses.DRAFT,
      },
    ];

    const folded = foldDraftsIntoBody(
      "Looks right 🚀\n\n---\n\nsignature line",
      placed,
      unplaced,
    );

    expect(folded).toHaveLength(337);
    expect(folded).toContain("**`src/gone.ts:LEFT 8-RIGHT 9`**");
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
