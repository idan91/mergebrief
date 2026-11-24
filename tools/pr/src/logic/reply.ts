import type { Result } from "types/utils";

import { readOriginUrl } from "./git";
import { parseRepoSlug, postReply } from "./github";
import { recordReply } from "./replies";
import type { StackStatusDeps } from "./stack-status";

export function runReply(
  deps: StackStatusDeps,
  pullNumber: number,
  commentId: number,
  bodyFile: string,
): Result<string, Error> {
  const origin = readOriginUrl(deps.git);
  if (!origin.ok) {
    return origin;
  }
  const slug = parseRepoSlug(origin.value);
  if (!slug.ok) {
    return slug;
  }
  const posted = postReply(
    deps.gh,
    slug.value,
    pullNumber,
    commentId,
    bodyFile,
  );
  if (!posted.ok) {
    return posted;
  }

  const recorded = recordReply(deps.replyStorePath, posted.value.id);
  if (!recorded.ok) {
    return {
      ok: false,
      error: new Error(
        `posted ${posted.value.url} but could not record it: ${recorded.error.message}`,
      ),
    };
  }
  return {
    ok: true,
    value: `replied ${posted.value.id} on ${commentId}: ${posted.value.url}`,
  };
}
