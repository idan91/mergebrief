import { describe, expect, it } from "vitest";

import { PostCommentResultKinds } from "../../../../model/types";
import { PostDraftOutcomes } from "../types";
import { POST_FAILURES } from "./useOwnDraftFlow";

describe("POST_FAILURES", () => {
  it.each([
    [PostCommentResultKinds.UNAUTHORIZED, PostDraftOutcomes.UNAUTHORIZED],
    [PostCommentResultKinds.NOT_FOUND, PostDraftOutcomes.NOT_FOUND],
    [PostCommentResultKinds.STALE, PostDraftOutcomes.STALE],
    [PostCommentResultKinds.ORPHANED_ANCHOR, PostDraftOutcomes.REJECTED],
    [PostCommentResultKinds.ALREADY_PUBLISHED, PostDraftOutcomes.REJECTED],
    [PostCommentResultKinds.INVALID, PostDraftOutcomes.REJECTED],
    [PostCommentResultKinds.NO_WRITE_ACCESS, PostDraftOutcomes.NO_PERMISSION],
    [PostCommentResultKinds.GITHUB_PERMISSION, PostDraftOutcomes.NO_PERMISSION],
    [PostCommentResultKinds.PUBLISH_PENDING, PostDraftOutcomes.INDETERMINATE],
    [PostCommentResultKinds.PUBLISH_IN_DOUBT, PostDraftOutcomes.INDETERMINATE],
    [PostCommentResultKinds.UPSTREAM, PostDraftOutcomes.INDETERMINATE],
    [PostCommentResultKinds.INDETERMINATE, PostDraftOutcomes.INDETERMINATE],
  ] as const)("reports a %s post as the %s outcome", (kind, outcome) => {
    expect(POST_FAILURES[kind].outcome).toBe(outcome);
  });
});
