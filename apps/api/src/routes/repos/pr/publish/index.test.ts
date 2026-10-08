import {
  addPullRequestReviewThread,
  createInlineReviewComment,
  createPullRequestReview,
  deletePendingPullRequestReview,
  GitHubApiErrorCodes,
  ReviewCommentSides,
  ReviewSubjectTypes,
  submitPullRequestReview,
} from "github";
import type * as githubModule from "github";
import type { Logger } from "logging";
import type { ReviewDraftCommentRow } from "persistence";
import { CommentAnchorKinds, DiffSides } from "types/comments";
import { ReviewOutcomes } from "types/reviews";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { makeDraftCommentRow } from "../../../../../test/fixtures";
import type {
  ReviewerGitHubClient,
  UserOctokit,
} from "../../../auth/reviewer-github-client";
import { isReviewUnsent, publishComment, publishReview } from "./index";

vi.mock("github", async (importOriginal) => ({
  ...(await importOriginal<typeof githubModule>()),
  createInlineReviewComment: vi.fn(),
  createPullRequestReview: vi.fn(),
  addPullRequestReviewThread: vi.fn(),
  submitPullRequestReview: vi.fn(),
  deletePendingPullRequestReview: vi.fn(),
}));

const log: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => log,
};

const TARGET = {
  owner: "acme",
  repo: "app",
  prNumber: 7,
  commitId: "a".repeat(40),
};

const OPEN_DEADLINE = new Date(Date.now() + 60 * 60 * 1000);
const THREAD_DURATION_MS = 1000;

function stubGitHubClient(): ReviewerGitHubClient {
  return {
    run: (call) => call("viewer-token"),
    runRead: (call) => call("viewer-token"),
    createOctokit: () => ({}) as UserOctokit,
    createMutationOctokit: () => ({}) as UserOctokit,
    session: () => {
      throw new Error("stub: no session");
    },
  };
}

const ANCHOR_FIELDS = [
  "path",
  "subjectType",
  "line",
  "side",
  "startLine",
  "startSide",
] as const;

function pickAnchorFields(input: object): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(input).filter(([key]) =>
      ANCHOR_FIELDS.some((field) => field === key),
    ),
  );
}

async function readCommentAnchor(
  draft: ReviewDraftCommentRow,
): Promise<Record<string, unknown>> {
  await publishComment({ github: stubGitHubClient(), log }, TARGET, draft);
  const [, input] = vi.mocked(createInlineReviewComment).mock.calls[0] ?? [];
  if (input === undefined) {
    throw new Error("no inline comment posted");
  }
  return pickAnchorFields(input);
}

async function readThreadAnchor(
  draft: ReviewDraftCommentRow,
): Promise<Record<string, unknown>> {
  await publishReview(
    { github: stubGitHubClient(), log },
    {
      target: TARGET,
      outcome: ReviewOutcomes.COMMENT,
      body: undefined,
      drafts: [draft],
      writeDeadline: OPEN_DEADLINE,
    },
  );
  const [, input] = vi.mocked(addPullRequestReviewThread).mock.calls[0] ?? [];
  if (input === undefined) {
    throw new Error("no thread posted");
  }
  const { subjectType, ...rest } = pickAnchorFields(input);
  if (subjectType === ReviewSubjectTypes.LINE) {
    return rest;
  }
  return { ...rest, subjectType };
}

beforeEach(() => {
  vi.mocked(createInlineReviewComment).mockReset();
  vi.mocked(createInlineReviewComment).mockResolvedValue({
    ok: true,
    value: { commentId: 1n },
  });
  vi.mocked(createPullRequestReview).mockReset();
  vi.mocked(createPullRequestReview).mockResolvedValue({
    ok: true,
    value: { reviewId: 2n, reviewNodeId: "PRR_node" },
  });
  vi.mocked(addPullRequestReviewThread).mockReset();
  vi.mocked(addPullRequestReviewThread).mockResolvedValue({
    ok: true,
    value: { threadId: "PRRT_node" },
  });
  vi.mocked(submitPullRequestReview).mockReset();
  vi.mocked(submitPullRequestReview).mockResolvedValue({
    ok: true,
    value: undefined,
  });
  vi.mocked(deletePendingPullRequestReview).mockReset();
  vi.mocked(deletePendingPullRequestReview).mockResolvedValue({
    ok: true,
    value: undefined,
  });
});

describe("publish transports", () => {
  it("anchor a two-side range the same on both transports", async () => {
    const draft = makeDraftCommentRow({
      anchor: {
        kind: CommentAnchorKinds.LINE,
        file: "src/c.ts",
        side: DiffSides.NEW,
        startSide: DiffSides.OLD,
        startLine: 8,
        endLine: 9,
      },
    });
    const expected = {
      path: "src/c.ts",
      line: 9,
      side: ReviewCommentSides.RIGHT,
      startLine: 8,
      startSide: ReviewCommentSides.LEFT,
    };

    expect(await readCommentAnchor(draft)).toEqual(expected);
    expect(await readThreadAnchor(draft)).toEqual(expected);
  });

  it("anchor a File comment the same on both transports", async () => {
    const draft = makeDraftCommentRow({
      anchor: { kind: CommentAnchorKinds.FILE, file: "src/app.ts" },
    });
    const expected = {
      path: "src/app.ts",
      subjectType: ReviewSubjectTypes.FILE,
    };

    expect(await readCommentAnchor(draft)).toEqual(expected);
    expect(await readThreadAnchor(draft)).toEqual(expected);
  });
});

describe("publishComment", () => {
  it("wraps a publish denial whole with phase mutation", async () => {
    vi.mocked(createInlineReviewComment).mockResolvedValue({
      ok: false,
      error: {
        code: GitHubApiErrorCodes.FORBIDDEN,
        status: 403,
        message: "denied",
        staleAnchor: false,
      },
    });

    const result = await publishComment(
      { github: stubGitHubClient(), log },
      TARGET,
      makeDraftCommentRow(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { kind: "github-denied", phase: "mutation" },
    });
  });
});

describe("publishReview", () => {
  it("discards the review unsent once the write deadline has passed", async () => {
    const result = await publishReview(
      { github: stubGitHubClient(), log },
      {
        target: TARGET,
        outcome: ReviewOutcomes.COMMENT,
        body: undefined,
        drafts: [makeDraftCommentRow()],
        writeDeadline: new Date(Date.now() - 1),
      },
    );

    expect(result).toEqual({ ok: false, error: { kind: "publish-expired" } });
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(isReviewUnsent(result.error)).toBe(true);
    expect(submitPullRequestReview).not.toHaveBeenCalled();
    expect(deletePendingPullRequestReview).toHaveBeenCalledTimes(1);
  });

  it("stops posting threads once the deadline passes mid-loop", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.now();
    vi.mocked(addPullRequestReviewThread).mockImplementation(async () => {
      vi.setSystemTime(Date.now() + THREAD_DURATION_MS);
      return { ok: true, value: { threadId: "PRRT_node" } };
    });

    try {
      const result = await publishReview(
        { github: stubGitHubClient(), log },
        {
          target: TARGET,
          outcome: ReviewOutcomes.COMMENT,
          body: undefined,
          drafts: [
            makeDraftCommentRow(),
            makeDraftCommentRow(),
            makeDraftCommentRow(),
          ],
          writeDeadline: new Date(startedAt + THREAD_DURATION_MS),
        },
      );

      expect(result).toEqual({ ok: false, error: { kind: "publish-expired" } });
      expect(addPullRequestReviewThread).toHaveBeenCalledTimes(1);
      expect(submitPullRequestReview).not.toHaveBeenCalled();
      expect(deletePendingPullRequestReview).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
