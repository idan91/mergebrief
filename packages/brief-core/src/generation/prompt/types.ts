import type { Brief } from "../../types";
import type { RepoContext } from "../repo-context";

/**
 * The previous brief plus the mechanical frozen/re-look partition the worker
 * computed. The renderer trims it to ids, definitions, verbatim
 * summary/verdicts and ordering sequences: never code, which the diff carries.
 */
export interface AnchorViewInput {
  readonly previousBrief: Brief;
  readonly frozenGroupIds: readonly string[];
}

export interface BriefPromptOptions {
  readonly repoContext?: RepoContext | undefined;
  readonly anchored?: boolean;
  readonly holdsMedia?: boolean;
}

export interface ProductDiffPromptOptions {
  readonly anchored?: boolean;
}
