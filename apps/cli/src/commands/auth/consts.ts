export const RELEASE_STRING_FIELDS = [
  "latest",
  "releaseNotesUrl",
  "checkedAt",
] as const;
export const RELEASE_FLAG_FIELDS = ["breaking", "security"] as const;

export const LAST_C0_CODE = 0x1f;
export const DELETE_CODE = 0x7f;
export const LAST_C1_CODE = 0x9f;

export const TOKEN_PREFIX = "mergebrief_";

export const UNSAFE_PROFILE_NAMES: ReadonlySet<string> = new Set([
  "__proto__",
  ".",
  "..",
  "",
]);
export const PATH_SEPARATOR = /[/\\]/;

/** Wider than github.com's own rule: an enterprise-managed user holds `_`. */
export const GITHUB_OWNER_SLUG = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
