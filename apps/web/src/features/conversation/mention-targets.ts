import {
  MentionQueryKeys,
  ProductQueryIds,
  type MentionTargetsResponse,
} from "contract";

import { HttpStatuses } from "types/http";

import { ApiError } from "../../data/apiFetch";
import { request } from "../../data/request";
import { mentionTargetsResponseSchema } from "./schemas";

const TARGET_SEPARATOR = ",";

/** A dead sign-in, a repo gone from view, or GitHub away: the mentions just stay plain text. */
const EXPECTED_LOOKUP_FAILURE_STATUSES: ReadonlySet<number> = new Set([
  HttpStatuses.UNAUTHORIZED,
  HttpStatuses.NOT_FOUND,
  HttpStatuses.BAD_GATEWAY,
  HttpStatuses.SERVICE_UNAVAILABLE,
]);

/** A refusal the lookup expects; a 400 is not one, since the page mirrors both of its causes. */
export function isExpectedLookupFailure(error: unknown): boolean {
  const expected =
    error instanceof ApiError &&
    EXPECTED_LOOKUP_FAILURE_STATUSES.has(error.status);
  return expected;
}

/** Which of these `login` and `org/slug` targets GitHub shows the viewer, in GitHub's casing. */
export function resolveMentionTargets(
  repoId: string,
  targets: readonly string[],
): Promise<MentionTargetsResponse> {
  return request(
    ProductQueryIds.RESOLVE_MENTION_TARGETS,
    {
      params: { repoId },
      query: { [MentionQueryKeys.TARGETS]: targets.join(TARGET_SEPARATOR) },
    },
    mentionTargetsResponseSchema,
  );
}
