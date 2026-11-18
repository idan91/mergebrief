import type { ValueOf } from "types";

export const LinkProblemKinds = {
  MISSING_FILE: "missing-file",
  MISSING_ANCHOR: "missing-anchor",
  OUTSIDE_REPO: "outside-repo",
  MALFORMED_HREF: "malformed-href",
} as const;

export type LinkProblemKind = ValueOf<typeof LinkProblemKinds>;

export interface LinkProblem {
  kind: LinkProblemKind;
  href: string;
}

/** `v<version>` for a release build, `main` otherwise. */
export type GitHubRef = `v${string}` | "main";

export interface LinkContext {
  /** Absolute repo root; a link resolving above it is refused. */
  repoRoot: string;
  /** Absolute `docs/`, the VitePress `srcDir`. */
  srcDir: string;
  /** Allow-listed pages, posix paths relative to `srcDir`. */
  sitePages: ReadonlySet<string>;
  ref: GitHubRef;
}
