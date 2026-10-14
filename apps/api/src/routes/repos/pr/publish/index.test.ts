import {
  GitHubApiErrorCodes,
  ReviewSubjectTypes,
  type ReviewerRepoClient,
} from "github";
import { FakeFailures, makeFakeGitHub, type FakeGitHub } from "github/testing";
import type { Logger } from "logging";
import type { ReviewDraftCommentRow } from "persistence";
import {
  CommentAnchorKinds,
  DiffSides,
  ReviewCommentSides,
  ReviewOutcomes,
} from "types";
import { describe, expect, it, vi } from "vitest";
import {
  PR_NUMBER,
  REPO_SLUG,
  makeDraftCommentRow,
} from "../../../../../test/fixtures";
import { arrangeFakePullRequest } from "../../../../../test/reviewer-github";
import { isReviewUnsent, publishComment, publishReview } from "./index";
import type { ReviewPublishInput } from "./types";

const log: Logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  child: () => log,
};

const PIN = { prNumber: PR_NUMBER, commitId: "a".repeat(40) };
const [REPO_OWNER = "", REPO_NAME = ""] = REPO_SLUG.split("/");

const OPEN_DEADLINE = new Date(Date.now() + 60 * 60 * 1000);
const THREAD_DURATION_MS = 1000;

/** The viewer's client on the suites' repository, served by `fake`. */
function bindFakeRepoClient(fake: FakeGitHub): ReviewerRepoClient {
  const credential = {
    readToken: async () => ({ ok: true, value: "viewer-token" }) as const,
    renewToken: async () => undefined,
  };
  return fake
    .bindReviewerGitHub(credential, { log })
    .forRepo({ owner: REPO_OWNER, repo: REPO_NAME });
}

function makeFakeWithPullRequest(): FakeGitHub {
  const fake = makeFakeGitHub();
  arrangeFakePullRequest(fake, { repoId: 424242 });
  return fake;
}

function makeReviewInput(
  drafts: readonly ReviewDraftCommentRow[],
  writeDeadline = OPEN_DEADLINE,
): ReviewPublishInput {
  return {
    pin: PIN,
    outcome: ReviewOutcomes.COMMENT,
    body: undefined,
    drafts,
    writeDeadline,
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
  const fake = makeFakeWithPullRequest();
  await publishComment(bindFakeRepoClient(fake), PIN, draft);
  const [call] = fake.listCalls("createInlineReviewComment");
  const input = call?.input;
  if (typeof input !== "object" || input === null) {
    throw new Error("no inline comment posted");
  }
  return pickAnchorFields(input);
}

async function readThreadAnchor(
  draft: ReviewDraftCommentRow,
): Promise<Record<string, unknown>> {
  const fake = makeFakeWithPullRequest();
  const repo = bindFakeRepoClient(fake);
  await publishReview({ repo, log }, makeReviewInput([draft]));
  const [call] = fake.listCalls("addPullRequestReviewThread");
  const input = call?.input;
  if (typeof input !== "object" || input === null) {
    throw new Error("no thread posted");
  }
  const { subjectType, ...rest } = pickAnchorFields(input);
  if (subjectType === ReviewSubjectTypes.LINE) {
    return rest;
  }
  return { ...rest, subjectType };
}

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
    const fake = makeFakeWithPullRequest();
    fake.failOn("createInlineReviewComment", FakeFailures.FORBIDDEN);

    const result = await publishComment(
      bindFakeRepoClient(fake),
      PIN,
      makeDraftCommentRow(),
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        kind: "github-denied",
        phase: "mutation",
        error: { code: GitHubApiErrorCodes.FORBIDDEN },
      },
    });
  });
});

describe("publishReview", () => {
  it("discards the review unsent once the write deadline has passed", async () => {
    const fake = makeFakeWithPullRequest();
    const repo = bindFakeRepoClient(fake);

    const result = await publishReview(
      { repo, log },
      makeReviewInput([makeDraftCommentRow()], new Date(Date.now() - 1)),
    );

    expect(result).toEqual({ ok: false, error: { kind: "publish-expired" } });
    if (result.ok) {
      throw new Error("unreachable");
    }
    expect(isReviewUnsent(result.error)).toBe(true);
    expect(fake.listCalls("submitPullRequestReview")).toEqual([]);
    expect(fake.listCalls("deletePendingPullRequestReview")).toHaveLength(1);
    expect(await repo.findPendingPullRequestReview(PR_NUMBER)).toEqual({
      ok: true,
      value: undefined,
    });
  });

  it("stops posting threads once the deadline passes mid-loop", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const startedAt = Date.now();
    const fake = makeFakeWithPullRequest();
    const client = bindFakeRepoClient(fake);
    const repo: ReviewerRepoClient = {
      ...client,
      async addPullRequestReviewThread(input) {
        vi.setSystemTime(Date.now() + THREAD_DURATION_MS);
        return client.addPullRequestReviewThread(input);
      },
    };
    const drafts = [
      makeDraftCommentRow(),
      makeDraftCommentRow(),
      makeDraftCommentRow(),
    ];

    try {
      const result = await publishReview(
        { repo, log },
        makeReviewInput(drafts, new Date(startedAt + THREAD_DURATION_MS)),
      );

      expect(result).toEqual({ ok: false, error: { kind: "publish-expired" } });
      expect(fake.listCalls("addPullRequestReviewThread")).toHaveLength(1);
      expect(fake.listCalls("submitPullRequestReview")).toEqual([]);
      expect(fake.listCalls("deletePendingPullRequestReview")).toHaveLength(1);
    } finally {
      vi.useRealTimers();
    }
  });
});
