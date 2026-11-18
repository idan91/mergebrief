import type { MentionSuggestionsResponse } from "contract";
import {
  GitHubApiErrorCodes,
  type GitHubCallFailure,
  type MentionableTeam,
  type MentionableUser,
  type ReviewerRepoClient,
} from "github";
import type { Logger } from "logging";
import type { Result } from "types/utils";
import type { RepoAccess } from "../../../access/types";
import { FailureKinds } from "../../../shared-errors/failures";
import { parseOwnerAndName } from "../utils";
import { MENTIONS_CACHE_TTL_MS } from "./consts";
import { isDeadCredential } from "./logic/dead-credential";
import type { MentionsDeps, MentionsFailure } from "./types";

const NOT_FOUND = { ok: false, error: { kind: "not-found" } } as const;

interface SearchPart<Value> {
  readonly values: readonly Value[];
  /** Every read behind it answered, so the whole answer may be cached. */
  readonly complete: boolean;
  /** Set when the viewer's token is dead; the route answers 401 instead. */
  readonly dead?: GitHubCallFailure;
}

const SKIPPED: SearchPart<never> = { values: [], complete: true };

function buildSuggestionsCacheKey(access: RepoAccess, query: string): string {
  const reviewerId = String(access.session.reviewerId);
  const repoId = String(access.repoId);
  const lowerQuery = query.toLowerCase();
  const cacheKey = `suggest:${reviewerId}:${repoId}:${lowerQuery}`;
  return cacheKey;
}

/**
 * The text after `@` reaches a team once it holds `/` naming the owner, or
 * while it is still the start of the owner's login; otherwise no team read.
 */
function deriveTeamQuery(owner: string, query: string): string | undefined {
  const lowerOwner = owner.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const slash = lowerQuery.indexOf("/");
  if (slash === -1) {
    const typingOwner = lowerQuery !== "" && lowerOwner.startsWith(lowerQuery);
    if (typingOwner) {
      return "";
    }
    return undefined;
  }

  const namesOwner = lowerQuery.slice(0, slash) === lowerOwner;
  if (!namesOwner) {
    return undefined;
  }
  const teamQuery = query.slice(slash + 1);
  return teamQuery;
}

function shapeFailedPart(error: GitHubCallFailure): SearchPart<never> {
  if (isDeadCredential(error)) {
    return { values: [], complete: false, dead: error };
  }
  return { values: [], complete: false };
}

async function searchUsers(
  client: ReviewerRepoClient,
  query: string,
  log: Logger,
): Promise<SearchPart<MentionableUser>> {
  if (query.includes("/")) {
    return SKIPPED;
  }
  const searched = await client.searchMentionableUsers(query);
  if (!searched.ok) {
    log.warn("mention user search failed", { code: searched.error.code });
    return shapeFailedPart(searched.error);
  }
  return { values: searched.value, complete: true };
}

async function searchTeams(
  client: ReviewerRepoClient,
  teamQuery: string | undefined,
  log: Logger,
): Promise<SearchPart<MentionableTeam>> {
  if (teamQuery === undefined) {
    return SKIPPED;
  }
  const searched = await client.searchMentionableTeams(teamQuery);
  if (searched.ok) {
    return { values: searched.value, complete: true };
  }

  // An installation that has not approved the members permission keeps
  // refusing; that is an answer worth caching, unlike an outage.
  if (searched.error.code === GitHubApiErrorCodes.FORBIDDEN) {
    return { values: [], complete: true };
  }
  log.warn("mention team search failed", { code: searched.error.code });
  return shapeFailedPart(searched.error);
}

/**
 * Who GitHub offers for the typed text, on the viewer's own token. A dead
 * token fails the request so the viewer signs in again; any other refusal
 * answers that part empty, so the composer falls back to the thread's
 * Participants. Only an answer every read gave is cached, per viewer.
 */
export async function searchMentionSuggestions(
  deps: MentionsDeps,
  access: RepoAccess,
  query: string,
): Promise<Result<string, MentionsFailure>> {
  const key = buildSuggestionsCacheKey(access, query);
  const now = Date.now();
  const cached = deps.cache.get(key, now);
  if (cached !== undefined) {
    return { ok: true, value: cached };
  }

  const repo = parseOwnerAndName(access.repoFullName);
  if (repo === undefined) {
    return NOT_FOUND;
  }
  const client = access.github.forRepo(repo);
  const teamQuery = deriveTeamQuery(repo.owner, query);
  const [users, teams] = await Promise.all([
    searchUsers(client, query, deps.log),
    searchTeams(client, teamQuery, deps.log),
  ]);
  const dead = users.dead ?? teams.dead;
  if (dead !== undefined) {
    return {
      ok: false,
      error: { kind: FailureKinds.GITHUB_DENIED, error: dead },
    };
  }

  const response: MentionSuggestionsResponse = {
    users: users.values,
    teams: teams.values,
  };
  const body = JSON.stringify(response);
  const complete = users.complete && teams.complete;
  if (complete) {
    deps.cache.set(key, body, now + MENTIONS_CACHE_TTL_MS, now);
  }
  return { ok: true, value: body };
}
