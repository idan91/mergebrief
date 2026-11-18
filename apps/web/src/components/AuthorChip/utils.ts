// GitHub's login shape: alphanumerics and single inner hyphens, at most 39
// characters, plus the inner underscore of an Enterprise Managed User's
// `handle_shortcode`. An App's bot account appends `[bot]` and lives under
// /apps/.
const USER_LOGIN = /^[a-z\d](?:[a-z\d]|[-_](?=[a-z\d])){0,38}$/i;
const BOT_SUFFIX = "[bot]";
const AVATAR_REQUEST_PX = 48;

export interface AuthorLinks {
  readonly profileUrl: string;
  /** Absent for a bot: GitHub serves no avatar by an App's bot login. */
  readonly avatarUrl?: string;
}

/** The author's GitHub profile and avatar; undefined for a value that is no GitHub login. */
export function buildAuthorLinks(login: string): AuthorLinks | undefined {
  if (login.endsWith(BOT_SUFFIX)) {
    const appSlug = login.slice(0, -BOT_SUFFIX.length);
    if (!USER_LOGIN.test(appSlug)) {
      return undefined;
    }
    return { profileUrl: `https://github.com/apps/${appSlug}` };
  }
  if (!USER_LOGIN.test(login)) {
    return undefined;
  }

  return {
    profileUrl: `https://github.com/${login}`,
    avatarUrl: `https://github.com/${login}.png?size=${String(AVATAR_REQUEST_PX)}`,
  };
}
