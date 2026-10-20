import type { ReviewerRepoClient } from "../client/types";
import {
  MAX_MENTION_TARGETS,
  MENTION_SEARCH_PAGE_SIZE,
} from "../operations/mentions/consts";
import {
  MentionTargetKinds,
  type MentionTarget,
  type MentionableTeam,
  type ResolvedMentionTargets,
} from "../operations/mentions/types";
import type { RepositoryRef } from "../operations/pull-request/types";
import type { FakeRunner } from "./runners";
import { answerNotFound, answerOk } from "./utils";
import type { FakeWorld } from "./world";

type ReviewerMentionReads = Pick<
  ReviewerRepoClient,
  "searchMentionableUsers" | "searchMentionableTeams" | "resolveMentionTargets"
>;

/** GitHub matches the typed text anywhere in the login or the name. */
function matchesMentionQuery(
  fields: readonly (string | undefined)[],
  query: string,
): boolean {
  const needle = query.toLowerCase();
  const matchesAnyField = fields.some((field) =>
    field?.toLowerCase().includes(needle),
  );
  return matchesAnyField;
}

/** GitHub's team search reads the slug and name, never the org login. */
function readTeamSlug(team: MentionableTeam): string {
  const slugStart = team.combinedSlug.indexOf("/") + 1;
  const slug = team.combinedSlug.slice(slugStart);
  return slug;
}

function resolveArrangedTargets(
  world: FakeWorld,
  targets: readonly MentionTarget[],
): ResolvedMentionTargets {
  const users: string[] = [];
  const teams: `${string}/${string}`[] = [];
  for (const target of targets) {
    if (target.kind === MentionTargetKinds.USER) {
      const login = world.findAccountLogin(target.login);
      if (login !== undefined) {
        users.push(login);
      }
      continue;
    }
    const combined = `${target.org}/${target.slug}`.toLowerCase();
    const team = world
      .findTeams(target.org)
      ?.find((listed) => listed.combinedSlug.toLowerCase() === combined);
    if (team !== undefined) {
      teams.push(team.combinedSlug);
    }
  }
  return { users, teams };
}

export function buildReviewerMentionReads(
  world: FakeWorld,
  repo: RepositoryRef,
  run: FakeRunner,
): ReviewerMentionReads {
  return {
    searchMentionableUsers(query) {
      return run({
        operation: "searchMentionableUsers",
        input: { ...repo, query },
        answer: () => {
          const state = world.findRepo(repo);
          if (state === undefined) {
            return answerNotFound("search mentionable users");
          }
          const matched = state.mentionableUsers.filter((user) =>
            matchesMentionQuery([user.login, user.name], query),
          );
          const firstPage = matched.slice(0, MENTION_SEARCH_PAGE_SIZE);
          return answerOk(firstPage);
        },
      });
    },
    searchMentionableTeams(query) {
      return run({
        operation: "searchMentionableTeams",
        input: { org: repo.owner, query },
        answer: () => {
          const teams = world.findTeams(repo.owner) ?? [];
          const matched = teams.filter((team) =>
            matchesMentionQuery([readTeamSlug(team), team.name], query),
          );
          const firstPage = matched.slice(0, MENTION_SEARCH_PAGE_SIZE);
          return answerOk(firstPage);
        },
      });
    },
    resolveMentionTargets(targets) {
      if (targets.length > MAX_MENTION_TARGETS) {
        const tooManyTargets = new Error(
          `mention lookup takes at most ${MAX_MENTION_TARGETS} targets`,
        );
        return Promise.reject(tooManyTargets);
      }
      return run({
        operation: "resolveMentionTargets",
        input: { targets },
        answer: () => {
          const resolved = resolveArrangedTargets(world, targets);
          return answerOk(resolved);
        },
      });
    },
  };
}
