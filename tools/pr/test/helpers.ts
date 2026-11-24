import type {
  Author,
  PullSnapshot,
  ReviewThread,
  ThreadComment,
} from "../src/types";

export const IDAN: Author = { login: "idan91", isBot: false };
export const BOT: Author = { login: "mergebrief", isBot: true };

export const ACTIVITY_SINCE = "2026-11-24T10:00:00Z";

export function makeComment(
  id: number,
  createdAt: string,
  author: Author = IDAN,
): ThreadComment {
  return { id, author, createdAt, path: "src/a.ts", line: 12 };
}

export function makeThread(
  comments: readonly ThreadComment[],
  overrides: Partial<ReviewThread> = {},
): ReviewThread {
  return { isResolved: false, isOutdated: false, comments, ...overrides };
}

export function makePull(overrides: Partial<PullSnapshot> = {}): PullSnapshot {
  return {
    number: 58,
    state: "OPEN",
    isDraft: true,
    head: "chore/BRIEF-476/1-pr-stack-status",
    base: "main",
    headSha: "1a2b3c4d5e6f7a8b9c0d",
    activitySince: ACTIVITY_SINCE,
    threadsTruncated: false,
    reviews: [],
    issueComments: [],
    threads: [],
    ...overrides,
  };
}
