// Reply transport: replies post IMMEDIATELY with the viewer's token,
// GitHub's create-review comments[] has no in_reply_to, so there is no
// batched alternative. Every failure is a RESULT KIND the composer renders.
import { ProductActionIds, type ReplyToCommentBody } from "contract";

import { ApiErrorCodes } from "../../data/apiFetch";
import { postedCommentSchema } from "../../data/postedComment";
import { readFailureKind, request } from "../../data/request";
import type { WriteKindTable } from "../../data/request/types";
import {
  ReplyResultKinds,
  type ReplyResult,
  type ReplyResultKind,
} from "./types";

/** The Brief a reply was written from; the API records the reply against it. */
export interface ReplyBriefSpan {
  readonly base: string;
  readonly head: string;
}

type ReplyFailureKind = Exclude<
  ReplyResultKind,
  typeof ReplyResultKinds.POSTED
>;

// A 413 is deterministic (over-long body): edit, never retry-as-is. A
// malformed 2xx means the reply may have posted.
const ReplyKinds: WriteKindTable<ReplyFailureKind> = {
  [ApiErrorCodes.NO_REPO_WRITE_ACCESS]: ReplyResultKinds.NO_WRITE_ACCESS,
  [ApiErrorCodes.NOT_FOUND]: ReplyResultKinds.NOT_FOUND,
  [ApiErrorCodes.INVALID_REQUEST]: ReplyResultKinds.INVALID,
  [ApiErrorCodes.ATTACHMENT_UNSUPPORTED_TYPE]: ReplyResultKinds.INVALID,
  [ApiErrorCodes.REQUEST_TOO_LARGE]: ReplyResultKinds.INVALID,
  [ApiErrorCodes.MALFORMED]: ReplyResultKinds.INDETERMINATE,
  fallback: ReplyResultKinds.UPSTREAM,
};

export async function postConversationReply(
  repoId: string,
  prNumber: number,
  span: ReplyBriefSpan,
  rootCommentId: number,
  text: string,
): Promise<ReplyResult> {
  const body: ReplyToCommentBody = { body: text };
  try {
    return await request(
      ProductActionIds.REPLY_TO_COMMENT,
      {
        params: { repoId, prNumber, commentId: rootCommentId },
        query: { base: span.base, head: span.head },
        body,
      },
      postedCommentSchema,
    );
  } catch (error) {
    return { kind: readFailureKind(error, ReplyKinds) };
  }
}
