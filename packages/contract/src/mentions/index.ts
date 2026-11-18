// The wire for mention suggestions and the mention-target lookup. The
// patterns are GitHub's login and team-slug rules as regex sources, so the
// api's validation and the web's renderer read one definition.
export {
  MentionQueryKeys,
  type MentionQueryKey,
  type MentionSuggestionsResponse,
  type MentionTargetsResponse,
  type MentionTeamView,
  type MentionUserView,
} from "./types";

export const MentionBounds = {
  /** A login is at most 39 characters; a team adds `/` and its slug. */
  QUERY_LENGTH: 140,
  /** Targets one lookup call checks; a page with more splits them. */
  TARGETS_PER_CALL: 50,
} as const;

export const MentionPatterns = {
  /**
   * 1 to 39 letters, digits or single inner hyphens; an enterprise-managed
   * login adds `_` and its enterprise shortcode.
   */
  LOGIN:
    "[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}(?:_[A-Za-z0-9]{1,39})?",
  /** A team slug never ends on the dot of a closing sentence. */
  TEAM_SLUG: "[A-Za-z0-9](?:[A-Za-z0-9_-]|\\.(?=[A-Za-z0-9])){0,99}",
} as const;
