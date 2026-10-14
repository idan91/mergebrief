import type { ConversationResponse } from "contract";
import type { GitHubReader, PrConversation, RepositoryRef } from "github";
import { isOwnerContext } from "persistence";
import type { Result } from "types/utils";
import { bindRepoInstallationGitHub } from "../../../../access/installation-binding";
import type { PullRequestAccess } from "../../../../access/types";
import { FailureKinds } from "../../../../shared-errors/failures";
import { parseOwnerAndName } from "../../utils";
import { CONVERSATION_CACHE_TTL_MS } from "./consts";
import { stripEntryComment } from "./logic/entry-comment";
import {
  ConversationCredentials,
  type ConversationCredential,
  type ConversationDeniedFailure,
  type ConversationDeps,
  type ReadConversationFailure,
} from "./types";
import { buildConversationCacheKey } from "./utils";

const NOT_FOUND = { ok: false, error: { kind: "not-found" } } as const;

interface ConversationReader {
  readonly github: GitHubReader;
  readonly credential: ConversationCredential;
}

/**
 * An Installation row reads as the App: one rate budget and one cache entry
 * per PR. An owner row has no Installation, so it reads on the viewer's
 * binding, which behind an operator pass falls back for the granted PR only.
 */
function selectConversationReader(
  deps: ConversationDeps,
  access: PullRequestAccess,
): ConversationReader {
  if (isOwnerContext(access.rowScope)) {
    return {
      github: access.github,
      credential: ConversationCredentials.VIEWER,
    };
  }
  const github = bindRepoInstallationGitHub(deps, access);
  return { github, credential: ConversationCredentials.APP };
}

async function fetchConversation(
  deps: ConversationDeps,
  access: PullRequestAccess,
  repo: RepositoryRef,
): Promise<Result<PrConversation, ConversationDeniedFailure>> {
  const reader = selectConversationReader(deps, access);
  const fetched = await reader.github
    .forRepo(repo)
    .fetchPullRequestConversation(access.prNumber);
  if (fetched.ok) {
    return fetched;
  }
  const { credential } = reader;
  return {
    ok: false,
    error: {
      kind: FailureKinds.GITHUB_DENIED,
      credential,
      error: fetched.error,
    },
  };
}

/**
 * The PR's conversation as the wire body, our Entry comment taken out. It
 * reads GitHub by the gate's verified slug, inside the gate's own 60s
 * staleness; a failure is never cached.
 */
export async function readConversation(
  deps: ConversationDeps,
  access: PullRequestAccess,
): Promise<Result<string, ReadConversationFailure>> {
  const { rowScope, repoId, prNumber } = access;
  const key = buildConversationCacheKey(rowScope, repoId, prNumber);
  const now = Date.now();
  const cached = deps.cache.get(key, now);
  if (cached !== undefined) {
    return { ok: true, value: cached };
  }

  const repo = parseOwnerAndName(access.repoFullName);
  if (repo === undefined) {
    return NOT_FOUND;
  }
  const fetched = await fetchConversation(deps, access, repo);
  if (!fetched.ok) {
    return fetched;
  }

  const entryCommentId = access.row.entryCommentId;
  const conversation: ConversationResponse = stripEntryComment(
    fetched.value,
    entryCommentId,
  );
  const body = JSON.stringify(conversation);
  deps.cache.set(key, body, now + CONVERSATION_CACHE_TTL_MS, now);
  return { ok: true, value: body };
}
