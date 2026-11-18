import type { MentionTargetsResponse } from "contract";
import { MentionTargetKinds, type MentionTarget } from "github";
import type { Result } from "types/utils";
import type { RepoAccess } from "../../../access/types";
import { parseOwnerAndName } from "../utils";
import { MENTIONS_CACHE_TTL_MS } from "./consts";
import { FailureKinds } from "../../../shared-errors/failures";
import { isDeadCredential } from "./logic/dead-credential";
import type { MentionsDeps, MentionsFailure } from "./types";

const NOT_FOUND = { ok: false, error: { kind: "not-found" } } as const;
const NOTHING_RESOLVED: MentionTargetsResponse = { users: [], teams: [] };
const NOTHING_RESOLVED_BODY = JSON.stringify(NOTHING_RESOLVED);

function formatTargetKey(target: MentionTarget): string {
  if (target.kind === MentionTargetKinds.USER) {
    return target.login;
  }
  const combinedSlug = `${target.org}/${target.slug}`;
  return combinedSlug;
}

function buildTargetsCacheKey(
  access: RepoAccess,
  targets: readonly MentionTarget[],
): string {
  const keys = targets.map(formatTargetKey);
  const sorted = keys.map((key) => key.toLowerCase()).toSorted();

  const reviewerId = String(access.session.reviewerId);
  const repoId = String(access.repoId);
  const targetList = sorted.join(",");
  const cacheKey = `targets:${reviewerId}:${repoId}:${targetList}`;
  return cacheKey;
}

/**
 * Which mentions on a page name someone GitHub shows the viewer, on the
 * viewer's own token. A dead token fails the request; any other failure
 * resolves nothing, so every mention stays plain text. An answer GitHub gave
 * is cached per viewer, an alias it refused included: that refusal repeats.
 */
export async function resolveMentionTargets(
  deps: MentionsDeps,
  access: RepoAccess,
  targets: readonly MentionTarget[],
): Promise<Result<string, MentionsFailure>> {
  if (targets.length === 0) {
    return { ok: true, value: NOTHING_RESOLVED_BODY };
  }
  const key = buildTargetsCacheKey(access, targets);
  const now = Date.now();
  const cached = deps.cache.get(key, now);
  if (cached !== undefined) {
    return { ok: true, value: cached };
  }

  const repo = parseOwnerAndName(access.repoFullName);
  if (repo === undefined) {
    return NOT_FOUND;
  }
  const resolved = await access.github
    .forRepo(repo)
    .resolveMentionTargets(targets);
  if (!resolved.ok) {
    if (isDeadCredential(resolved.error)) {
      return {
        ok: false,
        error: { kind: FailureKinds.GITHUB_DENIED, error: resolved.error },
      };
    }
    deps.log.warn("mention lookup failed", { code: resolved.error.code });
    return { ok: true, value: NOTHING_RESOLVED_BODY };
  }

  const response: MentionTargetsResponse = resolved.value;
  const body = JSON.stringify(response);
  deps.cache.set(key, body, now + MENTIONS_CACHE_TTL_MS, now);
  return { ok: true, value: body };
}
